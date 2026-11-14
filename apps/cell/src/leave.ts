import type { StationRegistry } from './cycle/registry';

/** The longest a leaving Cell waits for its Operators to hand over (PROTOCOL §9). */
export const LEAVE_CAP_MS = 5 * 60_000;

export interface LeaveDeps {
  registry: StationRegistry;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** How often the wait checks whether every station has ended. */
  pollMs: number;
  capMs?: number;
}

/**
 * Leaves the Cell (PROTOCOL §9): every live station is asked to hand over, and the leave waits until
 * they have all ended. A station that does not comply is released by its own run after the grace, so
 * the wait is bounded: past the cap the leave returns with what is still running, reported to the
 * caller, and nothing is claimed in the meantime.
 */
export const leaveCell = async (
  deps: LeaveDeps,
): Promise<{ remaining: number }> => {
  for (const handle of deps.registry.all()) handle.leave();
  const deadline = deps.now() + (deps.capMs ?? LEAVE_CAP_MS);
  while (deps.registry.all().length > 0 && deps.now() < deadline) {
    await deps.sleep(deps.pollMs);
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
      sleep: deps.sleep,
      now: deps.now,
      pollMs: deps.pollMs,
    }).then(({ remaining }) => deps.exit(remaining === 0 ? 0 : 1));
  });
};
