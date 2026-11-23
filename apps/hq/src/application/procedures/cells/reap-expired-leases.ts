import { and, inArray, lte, sql } from 'drizzle-orm';
import type { DbTx } from '../../../db/client';
import { factories } from '../../../db/schema/factories';
import { jobs } from '../../../db/schema/jobs';
import { LEASE_TTL_MS } from '../../../config';
import type { FactoryId } from '../../../domain/common/brand';
import { loseFactoryJobs, unpinOrders } from '../../orders/cell-release';
import { loseJob } from '../../orders/job-loss';
import type { Actor, TransitionLog } from '../../orders/order-writes';

const REAPER_ACTOR: Actor = { kind: 'system', id: null };
const EXPIRABLE_JOB_STATUSES = ['claimed', 'running'] as const;

const silentFactoryIds = (tx: DbTx, now: number): FactoryId[] =>
  tx
    .select({ factoryId: factories.factoryId })
    .from(factories)
    .where(sql`${factories.lastSeenAt} + ${LEASE_TTL_MS} <= ${now}`)
    .all()
    .map((row) => row.factoryId);

export const reapExpiredLeases = (
  tx: DbTx,
  now: number,
  log: TransitionLog,
): void => {
  const expired = tx
    .select()
    .from(jobs)
    .where(
      and(
        inArray(jobs.status, EXPIRABLE_JOB_STATUSES),
        lte(jobs.leaseExpiresAt, now),
      ),
    )
    .all();
  for (const job of expired) loseJob(tx, job, now, REAPER_ACTOR, log);
  for (const factoryId of silentFactoryIds(tx, now)) {
    loseFactoryJobs(tx, factoryId, now, REAPER_ACTOR, log);
    unpinOrders(tx, factoryId, now);
  }
};
