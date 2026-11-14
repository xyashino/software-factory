import type { Database } from 'bun:sqlite';
import type { WorkerId } from '@repo/factory-core/ids';
import type {
  WorkerInfo,
  WorkerRecord,
  WorkerStore,
} from '@repo/factory-core/ports/workers';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

interface CellRow {
  cell_id: string;
  name: string;
  joined_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
  info: string | null;
}

const recordOf = (row: CellRow): WorkerRecord => ({
  workerId: row.cell_id as WorkerId,
  name: row.name,
  info: row.info === null ? null : (JSON.parse(row.info) as WorkerInfo),
  joinedAt: row.joined_at,
  lastSeenAt: row.last_seen_at,
  revokedAt: row.revoked_at,
});

/** The `cells` table behind `WorkerStore`. `token_hash` marks the local, operating-system trust. */
export const sqliteWorkerStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): WorkerStore => ({
  hello: ({ workerId, name, info, at }) =>
    gate.run(() => {
      writer.assertHeld();
      db.run(
        `INSERT INTO cells (cell_id, name, token_hash, joined_at, last_seen_at, info)
         VALUES (?, ?, 'local:os-account', ?, ?, ?)
         ON CONFLICT(cell_id) DO UPDATE SET
           name = excluded.name, last_seen_at = excluded.last_seen_at, info = excluded.info`,
        [workerId, name, at, at, JSON.stringify(info)],
      );
    }),
  get: (workerId) =>
    gate.run(() => {
      const row = db
        .query<CellRow, [string]>('SELECT * FROM cells WHERE cell_id = ?')
        .get(workerId);
      return row ? recordOf(row) : undefined;
    }),
  list: () =>
    gate.run(() =>
      db
        .query<CellRow, []>('SELECT * FROM cells ORDER BY joined_at, cell_id')
        .all()
        .map(recordOf),
    ),
  touch: (workerId, at) =>
    gate.run(() => {
      writer.assertHeld();
      db.run('UPDATE cells SET last_seen_at = ? WHERE cell_id = ?', [
        at,
        workerId,
      ]);
    }),
  revoke: (workerId, at) =>
    gate.run(() => {
      writer.assertHeld();
      db.run(
        'UPDATE cells SET revoked_at = COALESCE(revoked_at, ?) WHERE cell_id = ?',
        [at, workerId],
      );
    }),
});
