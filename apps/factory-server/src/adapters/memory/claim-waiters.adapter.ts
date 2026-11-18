import { MAX_CLAIM_WAITERS } from '../../config';
import type { ClaimWaitersPort } from '../../application/ports/claim-waiters.port';

export const createClaimWaiters = (): ClaimWaitersPort => {
  const wakers = new Set<() => void>();
  return {
    waitForWake: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (wakers.size >= MAX_CLAIM_WAITERS || signal.aborted) {
          resolve();
          return;
        }
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', done);
          wakers.delete(done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        wakers.add(done);
        signal.addEventListener('abort', done, { once: true });
      }),
    wakeAll: () => {
      const pending = [...wakers];
      wakers.clear();
      for (const wake of pending) wake();
    },
  };
};
