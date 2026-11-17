import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import {
  HANDOVER_GRACE_MS,
  QUESTION_HOLD_MS,
} from '@repo/factory-core/cycle/policy';
import type { CommitSha, CycleId } from '@repo/factory-core/ids';
import { RUNNER_NAMES, getRunner } from '../adapters/runners/registry';
import type { RunnerAdapter } from '../adapters/runners/runner';
import { createRegistry } from '../cycle/registry';
import { runGit } from '../git';
import { cycleDirName } from '../names';
import { spawnHeadless } from '../runners/headless';
import { prepareWorkspace, type PrepareContext } from '../workspace/prepare';
import { runDeliver } from './deliver';
import { runPlanJob } from './plan';
import { runPublishBlocked } from './publish-blocked';
import { runInspection } from './run-inspection';
import { runMechanic } from './run-mechanic';
import {
  runOperatorStation,
  type AdoptedStation,
  type RunnerLaunch,
} from './run-operator-station';
import type { JobContext } from './send';

const STATION_TICK_MS = 1_000;

const asHeadless = (job: Job): Job =>
  job.station?.operator === undefined
    ? job
    : {
        ...job,
        station: {
          ...job.station,
          operator: { ...job.station.operator, headless: true },
        },
      };

/** An unknown job kind this Cell does not run. */
export class UnsupportedJobKind extends Error {
  constructor(kind: string) {
    super(`this Cell does not run ${kind} jobs yet`);
    this.name = 'UnsupportedJobKind';
  }
}

const launcherFor = (
  adapter: RunnerAdapter,
  operator: NonNullable<NonNullable<Job['station']>['operator']>,
  cycleDir: string,
): RunnerLaunch | undefined => {
  if (operator.headless) {
    if (!adapter.binary || !adapter.headlessArgs) return undefined;
    const headlessArgs = adapter.headlessArgs;
    return {
      binary: adapter.binary,
      kickoffArgs: (kickoff) =>
        headlessArgs({
          model: operator.model,
          permission: operator.permission,
          prompt: kickoff,
          addDirs: [cycleDir],
        }),
      ...(adapter.parseUsage ? { usage: adapter.parseUsage } : {}),
    };
  }
  return {
    binary: adapter.kind,
    kickoffArgs: () =>
      adapter.startArgs({
        model: operator.model,
        permission: operator.permission,
        addDirs: [cycleDir],
      }),
    ...(adapter.parseUsage ? { usage: adapter.parseUsage } : {}),
  };
};

const prepareContextOf = (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): PrepareContext => ({
  shell: {
    system: ctx.system,
    logDir: join(ctx.cellDataDir, 'logs', job.jobId),
    signal,
  },
  repoRoot: ctx.repoRoot,
  worktreeLimit: ctx.worktreeLimit,
  inUse: ctx.inUse,
});

const runnersFor = (
  job: Job,
  cellDataDir: string,
): Record<string, RunnerLaunch> => {
  const station = job.station;
  if (!station?.operator || !station.cycleId) return {};
  const cycleDir = join(
    cellDataDir,
    'cycles',
    cycleDirName(station.cycleId as CycleId),
  );
  const launchers: Record<string, RunnerLaunch> = {};
  for (const name of RUNNER_NAMES) {
    const adapter = getRunner(name);
    if (!adapter) continue;
    const launch = launcherFor(adapter, station.operator, cycleDir);
    if (launch) launchers[name] = launch;
  }
  return launchers;
};

/**
 * Dispatches a claimed job by its kind: `run_inspection`, `run_operator_station`, `mechanic`, `deliver`,
 * `publish_blocked`, and the three plan kinds. Any other kind throws `UnsupportedJobKind` before a command is sent, so its lease lapses and the
 * reaper takes it back. The job's log directory is removed when the job ends, whatever the outcome.
 */
export const runJob = async (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
  adopted?: AdoptedStation,
): Promise<Job | null> => {
  // The continuation the job's last command hands back, captured by `submit`.
  let continuation: Job | null = null;
  const jobCtx: JobContext = {
    ...ctx,
    onContinuation: (next) => {
      continuation = next;
    },
  };
  try {
    switch (job.kind) {
      case 'run_inspection':
        await runInspection(jobCtx, job, signal);
        return continuation;
      case 'run_operator_station': {
        const station = ctx.headlessOperators ? asHeadless(job) : job;
        // The station's worktree stays leased for the whole station, and is released when it ends.
        let releaseWorktree: (() => void) | undefined;
        try {
          return await runOperatorStation(
            station,
            {
              client: ctx.client,
              cellId: ctx.cellId,
              dataDir: ctx.cellDataDir,
              clock: { now: () => Date.now() },
              sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              git: runGit,
              workspace: async (current) => {
                const prepared = await prepareWorkspace(
                  prepareContextOf(ctx, current, signal),
                  current,
                );
                if (!prepared.ok) {
                  return {
                    ok: false,
                    stage: prepared.stage,
                    detail: prepared.detail,
                    ...(prepared.missing ? { missing: true } : {}),
                  };
                }
                releaseWorktree = prepared.release;
                return {
                  ok: true,
                  worktree: prepared.worktree,
                  base: prepared.head as CommitSha,
                };
              },
              runners: runnersFor(station, ctx.cellDataDir),
              spawn: spawnHeadless,
              ...(ctx.pane ? { pane: ctx.pane } : {}),
              ...(ctx.notify ? { notify: ctx.notify } : {}),
              timing: {
                tickMs: STATION_TICK_MS,
                questionHoldMs: QUESTION_HOLD_MS,
                handoverGraceMs: HANDOVER_GRACE_MS,
              },
              registry: ctx.stations ?? createRegistry(),
              signal,
              takeSignals: () => ctx.takeSignals?.(job.jobId) ?? [],
            },
            adopted,
          );
        } finally {
          releaseWorktree?.();
        }
      }
      case 'mechanic': {
        // A Mechanic job runs in a Herdr pane, never headless.
        if (!ctx.pane) {
          throw new Error('the Cell has no pane driver for a mechanic job');
        }
        return await runMechanic(job, {
          client: ctx.client,
          cellId: ctx.cellId,
          dataDir: ctx.cellDataDir,
          repoRoot: ctx.repoRoot,
          system: ctx.system,
          worktreeLimit: ctx.worktreeLimit,
          inUse: ctx.inUse,
          pane: ctx.pane,
          now: () => Date.now(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          tickMs: STATION_TICK_MS,
          signal,
        });
      }
      case 'deliver':
        await runDeliver(jobCtx, job, signal);
        // The task is done with its Herdr workspace once it is delivered.
        await ctx.pane
          ?.closeTask(job.orderId.slice(job.orderId.indexOf(':') + 1))
          .catch(() => undefined);
        return continuation;
      case 'publish_blocked':
        // Publishing the blocked work is best-effort, and its report never changes the Andon (the job ends with it).
        await runPublishBlocked(jobCtx, job, signal);
        return continuation;
      case 'plan_branch':
      case 'plan_pr':
      case 'plan_pr_ready':
        // A plan job has no continuation: its report ends it, and the next job is the plan's to offer.
        await runPlanJob(jobCtx, job, signal);
        return null;
      default:
        throw new UnsupportedJobKind(job.kind);
    }
  } finally {
    rmSync(join(ctx.cellDataDir, 'logs', job.jobId), {
      recursive: true,
      force: true,
    });
  }
};
