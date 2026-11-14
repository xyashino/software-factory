import type { Job } from '@repo/factory-core/contracts/job';
import type { StationRegistry } from './cycle/registry';

/** The longest a leaving Cell waits for its Operators to hand over (PROTOCOL §9). */
export const LEAVE_CAP_MS = 5 * 60_000;

/**
 * The plan jobs this Cell holds (PROTOCOL §4, §9). A leaving Cell lets each one finish within the cap;
 * the ones still running past it are released and stopped.
 */
export interface HeldPlanJobs {
  /** The plan jobs running on this Cell right now. */
  held(): readonly Job[];
  /** Sends `ReleaseJob` for the job, so it goes back to the queue. Failures are reported, not thrown. */
  release(job: Job): Promise<void>;
  /** Stops the job's run: it sends nothing more after this. */
  abort(job: Job): void;
}

export interface LeaveDeps {
  registry: StationRegistry;
  /** Plan jobs to wait for, then release past the cap. Absent when the Cell holds none to track. */
  plans?: HeldPlanJobs;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** How often the wait checks whether every station and plan job has ended. */
  pollMs: number;
  capMs?: number;
}

/**
 * Leaves the Cell (PROTOCOL §9): every live station is asked to hand over, and the leave waits until
 * they have all ended, and until the plan jobs it holds have finished. A station that does not comply is
 * released by its own run after the grace, so the wait is bounded: past the cap, each plan job still
 * running is released (`ReleaseJob`) and stopped, and the leave returns with the stations still running,
 * reported to the caller. Nothing is claimed in the meantime.
 */
export const leaveCell = async (
  deps: LeaveDeps,
): Promise<{ remaining: number }> => {
  for (const handle of deps.registry.all()) handle.leave();
  const deadline = deps.now() + (deps.capMs ?? LEAVE_CAP_MS);
  const busy = (): boolean =>
    deps.registry.all().length > 0 || (deps.plans?.held().length ?? 0) > 0;
  while (busy() && deps.now() < deadline) {
    await deps.sleep(deps.pollMs);
  }
  for (const job of deps.plans?.held() ?? []) {
    await deps.plans?.release(job);
    deps.plans?.abort(job);
  }
  return { remaining: deps.registry.all().length };
};

/** What the entrypoint injects to leave on `SIGTERM`: the wait, the signal hook and the exit. */
export interface LeaveSignalDeps extends Omit<LeaveDeps, 'capMs'> {
  on: (signal: 'SIGTERM', listener: () => void) => void;
  exit: (code: number) => void;
}

/**
 * Wires the leave to `SIGTERM` (PROTOCOL §9): the signal starts the leave, and the Cell exits when
 * every station has ended. Exit code 1 when the cap passed with stations still running.
 */
export const onLeaveSignal = (deps: LeaveSignalDeps): void => {
  deps.on('SIGTERM', () => {
    void leaveCell({
      registry: deps.registry,
      ...(deps.plans ? { plans: deps.plans } : {}),
      sleep: deps.sleep,
      now: deps.now,
      pollMs: deps.pollMs,
    }).then(({ remaining }) => deps.exit(remaining === 0 ? 0 : 1));
  });
};
