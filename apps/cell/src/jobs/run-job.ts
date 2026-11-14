import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Job } from '@repo/factory-core/contracts/job';
import {
  HANDOVER_GRACE_MS,
  QUESTION_HOLD_MS,
} from '@repo/factory-core/cycle/policy';
import type { CycleId } from '@repo/factory-core/ids';
import { RUNNER_NAMES, getRunner } from '../adapters/runners/registry';
import type { RunnerAdapter } from '../adapters/runners/runner';
import { createRegistry } from '../cycle/registry';
import { runGit } from '../git';
import { cycleDirName } from '../names';
import { spawnHeadless } from '../runners/headless';
import { prepareWorkspace } from '../workspace';
import { runDeliver } from './deliver';
import { runPlanJob } from './plan';
import { runInspection } from './run-inspection';
import { runOperatorStation, type RunnerLaunch } from './run-operator-station';
import type { JobContext } from './send';

const STATION_TICK_MS = 1_000;

/** The job as a headless Operator station: the Cell runs it through the runner's print mode. */
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
 * Dispatches a claimed job by its kind: `run_inspection`, `run_operator_station`, `deliver`, and the three
 * plan kinds. Any other kind throws `UnsupportedJobKind` before a command is sent, so its lease lapses and the
 * reaper takes it back. The job's log directory is removed when the job ends, whatever the outcome.
 */
export const runJob = async (
  ctx: JobContext,
  job: Job,
  signal: AbortSignal,
): Promise<Job | null> => {
  // The continuation the job's last command hands back, captured by `submit` (PROTOCOL §4).
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
        return await runOperatorStation(station, {
          client: ctx.client,
          cellId: ctx.cellId,
          dataDir: ctx.cellDataDir,
          clock: { now: () => Date.now() },
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          git: runGit,
          workspace: (current) =>
            prepareWorkspace({ job: current, dataDir: ctx.cellDataDir }),
          runners: runnersFor(station, ctx.cellDataDir),
          spawn: spawnHeadless,
          ...(ctx.pane ? { pane: ctx.pane } : {}),
          timing: {
            tickMs: STATION_TICK_MS,
            questionHoldMs: QUESTION_HOLD_MS,
            handoverGraceMs: HANDOVER_GRACE_MS,
          },
          registry: ctx.stations ?? createRegistry(),
          signal,
          takeSignals: () => ctx.takeSignals?.(job.jobId) ?? [],
        });
      }
      case 'deliver':
        await runDeliver(jobCtx, job, signal);
        return continuation;
      case 'plan_branch':
      case 'plan_pr':
      case 'plan_pr_ready':
        // A plan job has no continuation: its report ends it, and the next job is the plan's to offer (PROTOCOL §4).
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
