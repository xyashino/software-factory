import { MAX_CLAIM_WAITERS } from '../../config';
import type { ClaimWaitersPort } from '../../application/ports/claim-waiters.port';

export const createClaimWaiters = (): ClaimWaitersPort => {
  const resolvers = new Set<() => void>();
  return {
    park: () =>
      new Promise<void>((resolve, reject) => {
        if (resolvers.size >= MAX_CLAIM_WAITERS) {
          reject(new Error('Claim waiter capacity exceeded'));
          return;
        }
        resolvers.add(resolve);
      }),
    wakeAll: () => {
      const pending = [...resolvers];
      resolvers.clear();
      for (const resolve of pending) resolve();
    },
  };
};
