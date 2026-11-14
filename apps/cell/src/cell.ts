import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  MAX_CLAIM_WAIT_MS,
  type HelloResponse,
} from '@repo/factory-core/contracts/cell';
import type { CellId } from '@repo/factory-core/ids';
import type { CellConfig } from './config';
import { createRegistry } from './cycle/registry';
import type { GithubPort } from './ports/github.port';
import type { SystemPort } from './ports/system.port';
import type { ClockPort } from './ports/clock.port';
import { createGithubAdapter } from './adapters/github/github.adapter';
import { createJobRegistry } from './jobs/registry';
import { runJob } from './jobs/run-job';
import type { JobContext } from './jobs/send';
import { leaveCell } from './leave';
import { createHeartbeat } from './loops/heartbeat';
import { runSlot } from './loops/claim';
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
  /** The Cell's own data directory: mirrors, worktrees, logs. */
  cellDataDir: string;
  system: SystemPort;
  clock: ClockPort;
  version: string;
  /** Optional Herdr pane driver for non-headless Operator stations. */
  pane?: PaneDriver;
  timing?: CellTiming;
  sleep?: (ms: number) => Promise<void>;
  onError?: (error: unknown, context: string) => void;
  /** The GitHub port for a worktree directory. Defaults to the `gh` CLI; tests inject a fake. */
  githubFor?: (cwd: string) => GithubPort;
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
  /** Resolves once every slot has left its loop (after `stop`, a slot leaves at its next claim). */
  readonly slotsDone: Promise<void>;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts a Cell (PROTOCOL §5): `hello` for the runtime config, then one claim loop per slot and one
 * shared heartbeat loop. The heartbeat's self-fence uses the Factory's `selfFenceMs`, so the Cell stops
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
    slots: config.slots,
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
  });

  const jobContext: JobContext = {
    client,
    cellId,
    system: options.system,
    cellDataDir: options.cellDataDir,
    worktreeLimit: config.worktreeLimit,
    inUse: new Set(),
    stations,
    takeSignals: (jobId) => registry.takeSignals(jobId),
    ...(options.pane ? { pane: options.pane } : {}),
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

  const slots = Array.from({ length: config.slots }, () =>
    runSlot({
      client,
      cellId,
      registry,
      isFenced: () => heartbeat.fenced,
      isStopped,
      waitMs,
      idlePauseMs,
      sleep,
      runJob: (job, signal) => runJob(jobContext, job, signal),
      onError: options.onError,
    }),
  );

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
        sleep,
        now: () => options.clock.now(),
        pollMs,
      }).finally(() => {
        stop();
      });
      return leaving;
    },
    slotsDone: Promise.all(slots).then(() => undefined),
  };
};
