import type { Database } from 'bun:sqlite';
import type { ProjectId, TodoId } from '@repo/factory-core/ids';
import type {
  IntakeRecord,
  IntakeStore,
} from '@repo/factory-core/ports/intake';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

interface IntakeRow {
  project_id: string;
  todo_id: string;
  content_hash: string;
  seen_commit: string;
  diagnostic: string | null;
}

const recordOf = (row: IntakeRow): IntakeRecord => ({
  projectId: row.project_id as ProjectId,
  todoId: row.todo_id as TodoId,
  contentHash: row.content_hash,
  seenCommit: row.seen_commit,
  diagnostic: row.diagnostic,
});

/** The `intake` table behind `IntakeStore` (STORAGE §4). Every statement runs on the gate. */
export const sqliteIntakeStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): IntakeStore => ({
  get: (projectId, todoId) =>
    gate.run(() => {
      const row = db
        .query<IntakeRow, [string, string]>(
          'SELECT project_id, todo_id, content_hash, seen_commit, diagnostic FROM intake WHERE project_id = ? AND todo_id = ?',
        )
        .get(projectId, todoId);
      return row ? recordOf(row) : undefined;
    }),
  forProject: (projectId) =>
    gate.run(() =>
      db
        .query<IntakeRow, [string]>(
          'SELECT project_id, todo_id, content_hash, seen_commit, diagnostic FROM intake WHERE project_id = ? ORDER BY todo_id',
        )
        .all(projectId)
        .map(recordOf),
    ),
  upsert: (record) =>
    gate.run(() => {
      writer.assertHeld();
      db.run(
        `INSERT INTO intake (project_id, todo_id, content_hash, seen_commit, diagnostic)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project_id, todo_id) DO UPDATE SET
           content_hash = excluded.content_hash,
           seen_commit = excluded.seen_commit,
           diagnostic = excluded.diagnostic`,
        [
          record.projectId,
          record.todoId,
          record.contentHash,
          record.seenCommit,
          record.diagnostic,
        ],
      );
    }),
});
