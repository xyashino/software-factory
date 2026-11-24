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

const abortSignals = async (
  tx: StorageWriteTx,
  job: JobRow,
): Promise<CellSignal[]> => {
  if (job.status === 'cancelled') return ['abort'];
  if (job.orderId === null) return [];
  const order = await tx.orders.find(job.orderId);
  return order !== undefined &&
    ABORTING_ORDER_STATES.some((state) => state === order.state)
    ? ['abort']
    : [];
};

const recordHeartbeat = async (
  tx: StorageWriteTx,
  cellId: CellId,
  body: { jobId: string; epoch: number },
  now: number,
): Promise<Heartbeat | undefined> => {
  const job = await tx.jobs.find(asJobId(body.jobId));
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
      signals: await abortSignals(tx, job),
    };

  const leaseExpiresAt = addMs(now, LEASE_TTL_MS);
  await tx.jobs.update(job.jobId, { leaseExpiresAt });
  return { leaseExpiresAt, signals: await abortSignals(tx, job) };
};

export const heartbeatCellProcedure = scopedProcedure(['factory:worker'])(
  heartbeatCellContract,
)(async (input, ctx) => {
  const cellId = cellIdOf(ctx);
  const factoryId = factoryIdOf(ctx);
  const now = ctx.clock.now();
  const log: TransitionLog = [];

  const outcome = await ctx.storage.write(async (tx) => {
    await touchFactory(tx, factoryId, now);
    await reapExpiredLeases(tx, now, log);
    const heartbeat = await recordHeartbeat(tx, cellId, input.body, now);
    return {
      heartbeat,
      records: await flushTransitions(tx, log, {
        actorLabel: ctx.principal.name,
      }),
    };
  });
  publishCommitted(ctx, outcome.records);

  if (outcome.heartbeat === undefined)
    throw new StaleLeaseEpoch(
      `Job ${input.body.jobId} epoch ${input.body.epoch} is stale`,
    );
  return { code: 200 as const, ...outcome.heartbeat };
});
