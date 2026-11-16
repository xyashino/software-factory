import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  MAX_CLAIM_WAIT_MS,
  type HelloResponse,
} from '@repo/factory-core/contracts/cell';
import type { Job } from '@repo/factory-core/contracts/job';
import {
  isPlanId,
  type CellId,
  type JobId,
  type PlanId,
} from '@repo/factory-core/ids';
import type { CellConfig } from './config';
import { createRegistry } from './cycle/registry';
import { reconcileSessions } from './cycle/reconcile';
import type { AdoptedStation } from './jobs/run-operator-station';
import type { GithubPort } from './ports/github.port';
import type { SystemPort } from './ports/system.port';
import type { ClockPort } from './ports/clock.port';
import { createGithubAdapter } from './adapters/github/github.adapter';
import { createJobRegistry } from './jobs/registry';
import { runJob } from './jobs/run-job';
import type { NotifyFn } from './jobs/notify';
import type { JobContext } from './jobs/send';
import { leaveCell } from './leave';
import { createHeartbeat } from './loops/heartbeat';
import { runClaimLoop } from './loops/claim';
import type { PaneDriver } from './ports';

/** Loop timings the Factory does not decide: a test shortens them; the hello answer sets the rest. */
export interface CellTiming {
  heartbeatMs?: number;
  selfFenceMs?: number;
  claimWaitMs?: number;
  idlePauseMs?: number;
}

export interface CellOptions {
  client: FactoryClient;
  cellId: CellId;
  config: CellConfig;
  /** The repo the Cell works in (`loaded.repoRoot`): job worktrees live under its `.worktrees/`. */
  repoRoot: string;
  /** The Cell's own data directory: identity, logs, runtime journals, cycles. */
  cellDataDir: string;
  system: SystemPort;
  clock: ClockPort;
  version: string;
  /** Optional Herdr pane driver for non-headless Operator stations. */
  pane?: PaneDriver;
  /** Optional desktop toast (Herdr notification) for questions, blocks and deliveries. Unset when off. */
  notify?: NotifyFn;
  timing?: CellTiming;
  sleep?: (ms: number) => Promise<void>;
  onError?: (error: unknown, context: string) => void;
  /** The GitHub port for a worktree directory. Defaults to the `gh` CLI; tests inject a fake. */
  githubFor?: (cwd: string) => GithubPort;
  /**
   * The Factory refused this Cell's credential (401). The Cell stops its own jobs at once (`stop`), then
   * the caller joins again as a new Cell (PROTOCOL §1). Called at most once.
   */
  onUnauthorized?: () => void;
}

export interface RunningCell {
  /** The runtime config the Factory answered at hello (PROTOCOL §5.1). */
  readonly config: HelloResponse['config'];
  /** Stops claims, aborts every job, and stops the heartbeat. Jobs end at their next step. */
  stop(): void;
  /**
   * Leaves the Cell gracefully (PROTOCOL §9): pauses claims, asks every live Operator station to hand
   * over, waits up to the leave cap while heartbeats keep running, and then stops the Cell.
   */
  leave(pollMs?: number): Promise<{ remaining: number }>;
  /** Resolves once the claim loop has left (after `stop`, the loop leaves at its next claim). */
  readonly loopDone: Promise<void>;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts a Cell (PROTOCOL §5): `hello` for the runtime config, then one claim loop and one heartbeat
 * loop. The heartbeat's self-fence uses the Factory's `selfFenceMs`, so the Cell stops
 * its jobs before their lease can expire. A Cell that cannot reach the Factory at hello does not start.
 */
export const startCell = async (options: CellOptions): Promise<RunningCell> => {
  const { client, cellId, config } = options;
  const hello = await client.call('hello', {
    cellId,
    version: options.version,
    projects: config.projects,
    runners: config.runners,
    capabilities: config.capabilities,
  });

  const heartbeatMs = options.timing?.heartbeatMs ?? hello.config.heartbeatMs;
  const selfFenceMs = options.timing?.selfFenceMs ?? hello.config.selfFenceMs;
  const waitMs = Math.min(
    options.timing?.claimWaitMs ?? MAX_CLAIM_WAIT_MS,
    MAX_CLAIM_WAIT_MS,
  );
  const idlePauseMs = options.timing?.idlePauseMs ?? 1_000;
  const sleep = options.sleep ?? wait;

  const registry = createJobRegistry();
  const stations = createRegistry();
  let rejected = false;
  // A refused credential ends this Cell's work at once; the caller then joins again as a new Cell.
  const unauthorized = (): void => {
    if (rejected) return;
    rejected = true;
    stop();
    options.onUnauthorized?.();
  };
  const heartbeat = createHeartbeat({
    client,
    cellId,
    registry,
    clock: options.clock,
    selfFenceMs,
    onFence: (lastOkAt) =>
      options.onError?.(
        new Error(`no heartbeat since ${lastOkAt}; every job is stopped`),
        'self-fence',
      ),
    onUnauthorized: unauthorized,
  });

  const jobContext: JobContext = {
    client,
    cellId,
    system: options.system,
    repoRoot: options.repoRoot,
    cellDataDir: options.cellDataDir,
    worktreeLimit: config.worktreeLimit,
    inUse: new Set(),
    stations,
    takeSignals: (jobId) => registry.takeSignals(jobId),
    ...(options.pane ? { pane: options.pane } : {}),
    ...(options.notify ? { notify: options.notify } : {}),
    headlessOperators: config.headlessOperators,
    githubFor: options.githubFor ?? ((cwd) => createGithubAdapter(cwd)),
  };

  let stopping = false;
  let stopped = false;
  let leaving: Promise<{ remaining: number }> | undefined;
  const isStopped = (): boolean => stopping || stopped;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    stopping = true;
    clearInterval(beat);
    clearInterval(fenceCheck);
    registry.abortAll('the Cell is stopping');
  };

  // The plan jobs running here, so a leaving Cell can let them finish or release them (PROTOCOL §9).
  const heldPlans = new Map<JobId, Job>();
  const runHeld = (
    job: Job,
    signal: AbortSignal,
    adopted?: AdoptedStation,
  ): Promise<Job | null> => {
    if (!isPlanId(job.orderId)) return runJob(jobContext, job, signal, adopted);
    heldPlans.set(job.jobId, job);
    return runJob(jobContext, job, signal, adopted).finally(() => {
      heldPlans.delete(job.jobId);
    });
  };
  const releasePlan = async (job: Job): Promise<void> => {
    try {
      await client.call('submitCommand', {
        cellId,
        planId: job.orderId as PlanId,
        jobId: job.jobId,
        commandId: `${job.jobId}:release`,
        epoch: job.epoch,
        command: { type: 'ReleaseJob', jobId: job.jobId, epoch: job.epoch },
      });
    } catch (error) {
      options.onError?.(error, `release plan job ${job.jobId}`);
    }
  };

  // Panes a previous Cell left running are re-attached before the first claim and the first beat, so their
  // leases are extended from the start. Never throws: a session that cannot be re-attached is reported and skipped.
  await reconcileSessions({
    client,
    cellId,
    cellDataDir: options.cellDataDir,
    registry,
    ...(options.pane ? { pane: options.pane } : {}),
    run: runHeld,
    ...(options.onError ? { onError: options.onError } : {}),
  });

  const loop = runClaimLoop({
    client,
    cellId,
    registry,
    isFenced: () => heartbeat.fenced,
    isStopped,
    waitMs,
    idlePauseMs,
    sleep,
    runJob: runHeld,
    onError: options.onError,
    onUnauthorized: unauthorized,
  });

  const beat = setInterval(() => {
    void heartbeat.tick();
  }, heartbeatMs);
  // The fence is checked more often than a beat, so a silent Cell fences at its selfFenceMs, not a beat later.
  const fenceCheck = setInterval(
    () => heartbeat.checkFence(),
    Math.min(heartbeatMs, 1_000),
  );

  return {
    config: hello.config,
    stop,
    leave: (pollMs = 1_000) => {
      stopping = true;
      leaving ??= leaveCell({
        registry: stations,
        plans: {
          held: () => [...heldPlans.values()],
          release: releasePlan,
          abort: (job) => {
            registry.abort(
              job.jobId,
              'the Cell left; the plan job was released',
            );
          },
        },
        sleep,
        now: () => options.clock.now(),
        pollMs,
      }).finally(() => {
        stop();
      });
      return leaving;
    },
    loopDone: loop,
  };
};
