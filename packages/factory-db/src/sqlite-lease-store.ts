import type { Database } from 'bun:sqlite';
import type { JobId, OrderId, WorkerId } from '@repo/factory-core/ids';
import type { Lease, LeaseStore } from '@repo/factory-core/ports/lease-store';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

interface LeaseRow {
  order_id: string;
  job_id: string;
  cell_id: string;
  epoch: number;
  expires_at: number;
}

const leaseOf = (row: LeaseRow): Lease => ({
  orderId: row.order_id as OrderId,
  jobId: row.job_id as JobId,
  workerId: row.cell_id as WorkerId,
  epoch: row.epoch,
  expiresAt: row.expires_at,
});

/**
 * The `LeaseStore` over the `leases` table (STORAGE §4). `cell_id` holds the Worker id; the
 * `cells` row it references is written at `hello`. Each method is one statement section on the
 * gate, so it runs at once inside a claim transaction and queues behind the mutex otherwise.
 */
export const sqliteLeaseStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): LeaseStore => {
  const rowsOf = (sql: string, params: (string | number)[]): Lease[] =>
    db
      .query<LeaseRow, (string | number)[]>(sql)
      .all(...params)
      .map(leaseOf);

  return {
    insert: (lease) =>
      gate.run(() => {
        writer.assertHeld();
        db.run(
          'INSERT INTO leases (order_id, job_id, cell_id, epoch, expires_at) VALUES (?, ?, ?, ?, ?)',
          [
            lease.orderId,
            lease.jobId,
            lease.workerId,
            lease.epoch,
            lease.expiresAt,
          ],
        );
      }),
    extend: (workerId, jobIds: readonly JobId[], expiresAt) =>
      gate.run(() => {
        writer.assertHeld();
        const statement = db.query(
          'UPDATE leases SET expires_at = ? WHERE cell_id = ? AND job_id = ?',
        );
        for (const jobId of jobIds) {
          statement.run(expiresAt, workerId, jobId);
        }
      }),
    expired: (now) =>
      gate.run(() =>
        rowsOf(
          'SELECT * FROM leases WHERE expires_at <= ? ORDER BY expires_at, order_id',
          [now],
        ),
      ),
    list: () =>
      gate.run(() => rowsOf('SELECT * FROM leases ORDER BY order_id', [])),
    forWorker: (workerId) =>
      gate.run(() =>
        rowsOf('SELECT * FROM leases WHERE cell_id = ? ORDER BY order_id', [
          workerId,
        ]),
      ),
    delete: (orderId) =>
      gate.run(() => {
        writer.assertHeld();
        db.run('DELETE FROM leases WHERE order_id = ?', [orderId]);
      }),
  };
};
