import { inArray } from 'drizzle-orm';
import { immediateTx } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { jobs } from '../../../db/schema/jobs';
import { listCellsContract } from '@repo/factory-contracts/cells.contract';
import { scopedProcedure } from '../../core/procedure';
import {
  flushTransitions,
  publishCommitted,
  type TransitionLog,
} from '../../orders/order-writes';
import { reapExpiredLeases } from './reap-expired-leases';

const ACTIVE_JOB_STATUSES = ['claimed', 'running'] as const;

export const listCellsProcedure = scopedProcedure(['supervisor:read'])(
  listCellsContract,
)((_input, ctx) => {
  const now = ctx.clock.now();
  const log: TransitionLog = [];

  const outcome = immediateTx(ctx.db, (tx) => {
    reapExpiredLeases(tx, now, log);
    const rows = tx.select().from(cells).all();
    const leaseByJob = new Map(
      tx
        .select()
        .from(jobs)
        .where(inArray(jobs.status, ACTIVE_JOB_STATUSES))
        .all()
        .map((job) => [job.jobId, job.leaseExpiresAt] as const),
    );
    return {
      rows,
      leaseByJob,
      records: flushTransitions(tx, log),
    };
  });
  publishCommitted(ctx, outcome.records);

  return {
    code: 200 as const,
    cells: outcome.rows.map((row) => ({
      cellId: row.cellId,
      projectId: row.projectId,
      name: row.name,
      status: row.status,
      allowedLines: row.allowedLinesJson,
      runners: row.runnersJson,
      activeJobId: row.activeJobId,
      lastHeartbeatAt: row.lastHeartbeatAt,
      leaseExpiresAt:
        row.activeJobId === null
          ? null
          : (outcome.leaseByJob.get(row.activeJobId) ?? null),
      factoryId: row.factoryId,
    })),
  };
});
