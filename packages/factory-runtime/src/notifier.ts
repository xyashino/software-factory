import type { Timers } from './ports';

/**
 * Wakes the claims waiting on the queue. A commit calls `wake`; a waiter that is not woken returns
 * after its timer, so a claim never waits longer than the clock says (PROTOCOL §5.2).
 */
export interface Notifier {
  wake(): void;
  /** Resolves on the next `wake`, after `ms`, or when `signal` aborts, whichever comes first. */
  waitFor(ms: number, signal?: AbortSignal): Promise<void>;
}

export const createNotifier = (timers: Timers): Notifier => {
  let waiters: Array<() => void> = [];
  return {
    wake: () => {
      const current = waiters;
      waiters = [];
      for (const resume of current) resume();
    },
    waitFor: (ms, signal) =>
      new Promise<void>((resolve) => {
        let cancelTimer: () => void = () => undefined;
        const done = (): void => {
          cancelTimer();
          waiters = waiters.filter((waiter) => waiter !== done);
          signal?.removeEventListener('abort', done);
          resolve();
        };
        waiters.push(done);
        cancelTimer = timers.after(ms, done);
        signal?.addEventListener('abort', done, { once: true });
      }),
  };
};
