import { LEASE_TTL_MS } from '../../../config';
import { heartbeatCellContract } from '@repo/hq-contracts/cells.contract';
import { asJobId, type CellId } from '../../../domain/common/brand';
import { addMs } from '../../../domain/common/time';
import { StaleLeaseEpoch } from '../../core/error-handling';
import { cellIdOf, factoryIdOf, touchFactory } from '../../core/identity';
import { scopedProcedure } from '../../core/procedure';
import type { JobRow, StorageWriteTx } from '../../ports/storage.port';
import {
  flushTransitions,
  publishCommitted,
  type TransitionLog,
} from '../../orders/order-writes';
import { reapExpiredLeases } from './reap-expired-leases';

const FENCEABLE_JOB_STATUSES = ['claimed', 'running', 'cancelled'] as const;
const EXTENDABLE_JOB_STATUSES = ['claimed', 'running'] as const;
const ABORTING_ORDER_STATES = ['paused', 'cancelled'] as const;

type CellSignal = 'abort';
type Heartbeat = {
  leaseExpiresAt: number | null;
  signals: CellSignal[];
};

const abortSignals = (tx: StorageWriteTx, job: JobRow): CellSignal[] => {
  if (job.status === 'cancelled') return ['abort'];
  if (job.orderId === null) return [];
  const order = tx.orders.find(job.orderId);
  return order !== undefined &&
    ABORTING_ORDER_STATES.some((state) => state === order.state)
    ? ['abort']
    : [];
};

const recordHeartbeat = (
  tx: StorageWriteTx,
  cellId: CellId,
  body: { jobId: string; epoch: number },
  now: number,
): Heartbeat | undefined => {
  const job = tx.jobs.find(asJobId(body.jobId));
  const fenced =
    job !== undefined &&
    job.claimedByCellId === cellId &&
    job.epoch === body.epoch &&
    FENCEABLE_JOB_STATUSES.some((status) => status === job.status);
  if (job === undefined || !fenced) return undefined;

  const extendable = EXTENDABLE_JOB_STATUSES.some(
    (status) => status === job.status,
  );
  if (!extendable)
    return {
      leaseExpiresAt: job.leaseExpiresAt,
      signals: abortSignals(tx, job),
    };

  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);
  tx.jobs.update(job.jobId, { leaseExpiresAt });
  return { leaseExpiresAt, signals: abortSignals(tx, job) };
};

export const heartbeatCellProcedure = scopedProcedure(['factory:worker'])(
  heartbeatCellContract,
)(async (input, ctx) => {
  const cellId = cellIdOf(ctx);
  const factoryId = factoryIdOf(ctx);
  const now = ctx.clock.now();
  const log: TransitionLog = [];

  const outcome = await ctx.storage.write((tx) => {
    touchFactory(tx, factoryId, now);
    reapExpiredLeases(tx, now, log);
    const heartbeat = recordHeartbeat(tx, cellId, input.body, now);
    return { heartbeat, records: flushTransitions(tx, log) };
  });
  publishCommitted(ctx, outcome.records);

  if (outcome.heartbeat === undefined)
    throw new StaleLeaseEpoch(
      `Job ${input.body.jobId} epoch ${input.body.epoch} is stale`,
    );
  return { code: 200 as const, ...outcome.heartbeat };
});
