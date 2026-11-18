import { and, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { jobs } from '../../../db/schema/jobs';
import { LEASE_TTL_MS } from '../../../config';
import { loseJob } from '../../orders/job-loss';
import type { Actor, TransitionLog } from '../../orders/order-writes';

const REAPER_ACTOR: Actor = { kind: 'system', id: null };
const EXPIRABLE_JOB_STATUSES = ['claimed', 'running'] as const;
const SILENT_CELL_STATUSES = ['online', 'busy', 'draining'] as const;

const markSilentCellsOffline = (tx: DbTx, now: number): void => {
  tx.update(cells)
    .set({ status: 'offline' })
    .where(
      and(
        isNotNull(cells.lastHeartbeatAt),
        sql`${cells.lastHeartbeatAt} + ${LEASE_TTL_MS} <= ${now}`,
        inArray(cells.status, SILENT_CELL_STATUSES),
      ),
    )
    .run();
};

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
  markSilentCellsOffline(tx, now);
};
