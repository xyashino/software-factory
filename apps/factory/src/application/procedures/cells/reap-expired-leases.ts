import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { DbTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { factories } from '../../../db/schema/factories';
import { jobs } from '../../../db/schema/jobs';
import { LEASE_TTL_MS } from '../../../config';
import { asCellId } from '../../../domain/common/brand';
import { loseJob } from '../../orders/job-loss';
import type { Actor, TransitionLog } from '../../orders/order-writes';
import { goneCell } from './gone-cell';

const REAPER_ACTOR: Actor = { kind: 'system', id: null };
const EXPIRABLE_JOB_STATUSES = ['claimed', 'running'] as const;

const goneSilentCells = (tx: DbTx, now: number, log: TransitionLog): void => {
  const silent = tx
    .select({ cellId: cells.cellId })
    .from(cells)
    .where(
      and(
        isNotNull(cells.lastHeartbeatAt),
        sql`${cells.lastHeartbeatAt} + ${LEASE_TTL_MS} <= ${now}`,
      ),
    )
    .all();
  for (const { cellId } of silent)
    goneCell(tx, asCellId(cellId), now, REAPER_ACTOR, log);
};

const goneDeadFactoryCells = (
  tx: DbTx,
  now: number,
  log: TransitionLog,
): void => {
  const dead = tx
    .select({ factoryId: factories.factoryId })
    .from(factories)
    .where(sql`${factories.lastSeenAt} + ${LEASE_TTL_MS} <= ${now}`)
    .all();
  for (const { factoryId } of dead) {
    const owned = tx
      .select({ cellId: cells.cellId })
      .from(cells)
      .where(eq(cells.factoryId, factoryId))
      .all();
    for (const { cellId } of owned)
      goneCell(tx, asCellId(cellId), now, REAPER_ACTOR, log);
  }
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
  goneSilentCells(tx, now, log);
  goneDeadFactoryCells(tx, now, log);
};
