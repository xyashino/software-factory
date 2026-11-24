import type { CellId, FactoryId } from '../../domain/common/brand';
import type { StorageWriteTx } from '../ports/storage.port';
import { loseJob } from './job-loss';
import {
  updateWorkOrder,
  type Actor,
  type TransitionLog,
} from './order-writes';

export const unpinOrders = async (
  tx: StorageWriteTx,
  factoryId: FactoryId,
  now: number,
): Promise<void> => {
  for (const row of await tx.orders.list({ pinnedFactoryId: factoryId }))
    await updateWorkOrder(tx, row, { pinnedFactoryId: null }, now);
};

export const loseFactoryJobs = async (
  tx: StorageWriteTx,
  factoryId: FactoryId,
  now: number,
  actor: Actor,
  log: TransitionLog,
): Promise<void> => {
  for (const job of await tx.jobs.listActiveByFactory(factoryId))
    await loseJob(tx, job, now, actor, log);
};

export const loseCellJob = async (
  tx: StorageWriteTx,
  cellId: CellId,
  factoryId: FactoryId,
  now: number,
  actor: Actor,
  log: TransitionLog,
): Promise<void> => {
  const job = await tx.jobs.findActiveByCellInFactory(cellId, factoryId);
  if (job !== undefined) await loseJob(tx, job, now, actor, log);
};
