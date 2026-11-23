import { eq } from 'drizzle-orm';
import { immediateTx, type DbTx } from '../../../db/client';
import { jobs } from '../../../db/schema/jobs';
import { workOrders } from '../../../db/schema/orders';
import { LEASE_TTL_MS } from '../../../config';
import { heartbeatCellContract } from '@repo/hq-contracts/cells.contract';
import { asJobId, type CellId } from '../../../domain/common/brand';
import { addMs } from '../../../domain/common/time';
import { StaleLeaseEpoch } from '../../core/error-handling';
import { cellIdOf, factoryIdOf, touchFactory } from '../../core/identity';
import { scopedProcedure } from '../../core/procedure';
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
type JobRow = typeof jobs.$inferSelect;
type Heartbeat = {
  leaseExpiresAt: number | null;
  signals: CellSignal[];
};

const abortSignals = (tx: DbTx, job: JobRow): CellSignal[] => {
  if (job.status === 'cancelled') return ['abort'];
  if (job.orderId === null) return [];
  const order = tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, job.orderId))
    .get();
  return order !== undefined &&
    ABORTING_ORDER_STATES.some((state) => state === order.state)
    ? ['abort']
    : [];
};

const recordHeartbeat = (
  tx: DbTx,
  cellId: CellId,
  body: { jobId: string; epoch: number },
  now: number,
): Heartbeat | undefined => {
  const job = tx
    .select()
    .from(jobs)
    .where(eq(jobs.jobId, asJobId(body.jobId)))
    .get();
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
  tx.update(jobs)
    .set({ leaseExpiresAt })
    .where(eq(jobs.jobId, job.jobId))
    .run();
  return { leaseExpiresAt, signals: abortSignals(tx, job) };
};

export const heartbeatCellProcedure = scopedProcedure(['factory:worker'])(
  heartbeatCellContract,
)((input, ctx) => {
  const cellId = cellIdOf(ctx);
  const factoryId = factoryIdOf(ctx);
  const now = ctx.clock.now();
  const log: TransitionLog = [];

  const outcome = immediateTx(ctx.db, (tx) => {
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
