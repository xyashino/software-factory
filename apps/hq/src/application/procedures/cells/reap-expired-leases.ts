import type { FactoryId } from '../../../domain/common/brand';
import { isSilent } from '../../core/identity';
import type { StorageWriteTx } from '../../ports/storage.port';
import { loseFactoryJobs, unpinOrders } from '../../orders/cell-release';
import { loseJob } from '../../orders/job-loss';
import type { Actor, TransitionLog } from '../../orders/order-writes';

const REAPER_ACTOR: Actor = { kind: 'system', id: null };

const silentFactoryIds = (tx: StorageWriteTx, now: number): FactoryId[] =>
  tx.factories
    .list()
    .filter((row) => isSilent(row.lastSeenAt, now))
    .map((row) => row.factoryId);

export const reapExpiredLeases = (
  tx: StorageWriteTx,
  now: number,
  log: TransitionLog,
): void => {
  for (const job of tx.jobs.listExpired(now))
    loseJob(tx, job, now, REAPER_ACTOR, log);
  for (const factoryId of silentFactoryIds(tx, now)) {
    loseFactoryJobs(tx, factoryId, now, REAPER_ACTOR, log);
    unpinOrders(tx, factoryId, now);
  }
};
