import type { CellId, FactoryId } from '../../domain/common/brand';
import type { StorageWriteTx } from '../ports/storage.port';
import { loseJob } from './job-loss';
import {
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from './order-writes';

export const unpinOrders = (
  tx: StorageWriteTx,
  factoryId: FactoryId,
  now: number,
): void => {
  for (const row of tx.orders.list({ pinnedFactoryId: factoryId }))
    updateWorkOrder(tx, row, { pinnedFactoryId: null }, now);
};

export const loseFactoryJobs = (
  tx: StorageWriteTx,
  factoryId: FactoryId,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  for (const job of tx.jobs.listActiveByFactory(factoryId))
    loseJob(tx, job, now, actor, log);
};

export const loseCellJob = (
  tx: StorageWriteTx,
  cellId: CellId,
  factoryId: FactoryId,
  now: number,
  actor: Actor,
  log: TransitionLog,
): void => {
  const job = tx.jobs.findActiveByCellInFactory(cellId, factoryId);
  if (job !== undefined) loseJob(tx, job, now, actor, log);
};
