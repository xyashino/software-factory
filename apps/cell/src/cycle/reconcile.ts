import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId } from '@repo/factory-core/ids';
import type { JobRegistry } from '../jobs/registry';
import type { AdoptedStation } from '../jobs/run-operator-station';
import type { PaneDriver } from '../ports';
import { deleteSession, listSessions, type Session } from './session';

export interface ReconcileOptions {
  client: FactoryClient;
  cellId: CellId;
  /** The Cell's data directory, where the session files live. */
  cellDataDir: string;
  registry: JobRegistry;
  /** The Herdr driver. Without one no pane can be adopted, so every session is discarded. */
  pane?: PaneDriver;
  /**
   * Runs one job to its end. An adopted station comes with its state; a continuation the adopted
   * station hands back comes without one.
   */
  run: (
    job: Job,
    signal: AbortSignal,
    adopted?: AdoptedStation,
  ) => Promise<Job | null>;
  onError?: (error: unknown, context: string) => void;
}

/** What a session holds, read back as the station the run needs. */
const adoptedOf = (session: Session): AdoptedStation => ({
  paneName: session.paneName,
  tabId: session.tabId,
  worktree: session.worktree,
  token: session.operatorToken,
  port: session.operatorPort,
  cycle: session.cycle,
  ...(session.readOnlyBaseline === undefined
    ? {}
    : { readOnlyBaseline: session.readOnlyBaseline }),
});

/**
 * Closes the pane a session names and removes the session. The pane is not this process's, so its tab
 * is re-learned from the session first. A close that fails is not an error: the pane is already gone.
 */
const discard = async (
  options: ReconcileOptions,
  session: Session,
): Promise<void> => {
  if (options.pane !== undefined) {
    options.pane.adopt(session.paneName, { tabId: session.tabId });
    await options.pane.close(session.paneName).catch(() => undefined);
  }
  deleteSession(options.cellDataDir, session.cycleId);
};

/**
 * Runs an adopted station, then any continuation it hands back, the way the claim loop runs one.
 * A station that fails to adopt (its endpoint port is taken, say) discards its pane and session.
 */
const runChain = async (
  options: ReconcileOptions,
  session: Session,
  first: Job,
  adopted: AdoptedStation,
): Promise<void> => {
  let current: Job | null = first;
  let state: AdoptedStation | undefined = adopted;
  while (current !== null) {
    const job: Job = current;
    const handle = options.registry.start(job.jobId);
    try {
      current = await options.run(job, handle.signal, state);
    } catch (error) {
      options.onError?.(error, `adopted job ${job.jobId}`);
      current = null;
      if (state !== undefined) await discard(options, session);
    } finally {
      options.registry.finish(job.jobId);
    }
    state = undefined;
  }
};

/**
 * Re-attaches one session, or cleans it up (PROTOCOL §5.4, §9). A pane that is gone is discarded. A
 * pane still running is adopted only if the Factory still holds its job for this Cell: a heartbeat
 * that answers `ok` extends the lease at once, so the adopted job keeps it. A job the Factory no
 * longer holds (stale epoch, lease lost) has its pane closed. A failed heartbeat keeps the session
 * for the next start, so a Factory that is down at boot loses nothing.
 */
const reconcileOne = async (
  options: ReconcileOptions,
  session: Session,
): Promise<void> => {
  if (options.pane === undefined) return discard(options, session);
  const reading = await options.pane.read(session.paneName);
  if (reading.operator === 'gone') return discard(options, session);

  const answer = await options.client.call('heartbeat', {
    cellId: options.cellId,
    jobs: [session.jobId],
    acked: [],
  });
  const held = answer.jobs.some(
    (entry) => entry.jobId === session.jobId && entry.status === 'ok',
  );
  if (!held) return discard(options, session);

  // The chain registers the job synchronously, before any beat can run, and runs it in the background:
  // a re-adopted Operator does not hold up the claim loop.
  void runChain(options, session, session.job, adoptedOf(session));
};

/**
 * Re-attaches every live Herdr pane a previous Cell of this machine left running (CORE §9, v1 reconcile).
 * Runs once, before the claim loop and the heartbeat start. Each session is handled on its own: an error
 * is reported through `onError` and the session is skipped, so no failure here reaches `startCell`.
 */
export const reconcileSessions = async (
  options: ReconcileOptions,
): Promise<void> => {
  for (const session of listSessions(options.cellDataDir)) {
    try {
      await reconcileOne(options, session);
    } catch (error) {
      options.onError?.(error, `reconcile ${session.jobId}`);
    }
  }
};
