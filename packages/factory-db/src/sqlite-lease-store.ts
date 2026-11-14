import type { Database } from 'bun:sqlite';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import type { CellId, JobId, OrderId } from '@repo/factory-core/ids';
import type { Lease, LeaseStore } from '@repo/factory-core/ports/lease-store';
import { drizzleOf, type FactoryDatabase } from './db';
import { type LeaseRecord, leases } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

const leaseOf = (row: LeaseRecord): Lease => ({
  orderId: row.orderId as OrderId,
  jobId: row.jobId as JobId,
  cellId: row.cellId as CellId,
  epoch: row.epoch,
  expiresAt: row.expiresAt,
});

const selectLeases = (orm: FactoryDatabase) => orm.select().from(leases);

/**
 * The `LeaseStore` over the `leases` table (STORAGE §4). `cell_id` references the `cells` row, which
 * is written at `hello`. Writes assert the writer lock and run through the statement gate, so they
 * queue behind the write mutex unless they are already inside a transaction.
 */
export const sqliteLeaseStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): LeaseStore => {
  const orm = drizzleOf(db);
  return {
    insert: (lease) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .insert(leases)
          .values({
            orderId: lease.orderId,
            jobId: lease.jobId,
            cellId: lease.cellId,
            epoch: lease.epoch,
            expiresAt: lease.expiresAt,
          })
          .run();
      }),
    extend: (cellId, jobIds: readonly JobId[], expiresAt) =>
      gate.run(() => {
        writer.assertHeld();
        if (jobIds.length === 0) return;
        orm
          .update(leases)
          .set({ expiresAt })
          .where(
            and(eq(leases.cellId, cellId), inArray(leases.jobId, [...jobIds])),
          )
          .run();
      }),
    expired: (now) =>
      gate.run(() =>
        selectLeases(orm)
          .where(lte(leases.expiresAt, now))
          .orderBy(asc(leases.expiresAt), asc(leases.orderId))
          .all()
          .map(leaseOf),
      ),
    list: () =>
      gate.run(() =>
        selectLeases(orm).orderBy(asc(leases.orderId)).all().map(leaseOf),
      ),
    forCell: (cellId) =>
      gate.run(() =>
        selectLeases(orm)
          .where(eq(leases.cellId, cellId))
          .orderBy(asc(leases.orderId))
          .all()
          .map(leaseOf),
      ),
    delete: (orderId) =>
      gate.run(() => {
        writer.assertHeld();
        orm.delete(leases).where(eq(leases.orderId, orderId)).run();
      }),
    bootGrace: (now, ttl) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .update(leases)
          .set({ expiresAt: now + ttl })
          .run();
      }),
  };
};
