import type { FactoryId } from '../../../domain/common/brand';
import { isSilent } from '../../core/identity';
import type { StorageWriteTx } from '../../ports/storage.port';
import { loseFactoryJobs, unpinOrders } from '../../orders/cell-release';
import { loseJob } from '../../orders/job-loss';
import type { Actor, TransitionLog } from '../../orders/order-writes';

const REAPER_ACTOR: Actor = { kind: 'system', id: null };

const silentFactoryIds = async (
  tx: StorageWriteTx,
  now: number,
): Promise<FactoryId[]> =>
  (await tx.factories.list())
    .filter((row) => isSilent(row.lastSeenAt, now))
    .map((row) => row.factoryId);

export const reapExpiredLeases = async (
  tx: StorageWriteTx,
  now: number,
  log: TransitionLog,
): Promise<void> => {
  for (const job of await tx.jobs.listExpired(now))
    await loseJob(tx, job, now, REAPER_ACTOR, log);
  for (const factoryId of await silentFactoryIds(tx, now)) {
    await loseFactoryJobs(tx, factoryId, now, REAPER_ACTOR, log);
    await unpinOrders(tx, factoryId, now);
  }
};
