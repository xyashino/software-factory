import type { Database } from 'bun:sqlite';
import type { ProjectId, TodoId } from '@repo/factory-core/ids';
import type {
  IntakeRecord,
  IntakeStore,
} from '@repo/factory-core/ports/intake';
import { and, asc, eq } from 'drizzle-orm';
import { drizzleOf } from './db';
import { intake } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

type IntakeRow = typeof intake.$inferSelect;

const recordOf = (row: IntakeRow): IntakeRecord => ({
  projectId: row.projectId as ProjectId,
  todoId: row.todoId as TodoId,
  contentHash: row.contentHash,
  seenCommit: row.seenCommit,
  diagnostic: row.diagnostic,
});

/** The `intake` table behind `IntakeStore` (STORAGE §4). Every statement runs on the gate. */
export const sqliteIntakeStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): IntakeStore => {
  const orm = drizzleOf(db);
  return {
    get: (projectId, todoId) =>
      gate.run(() => {
        const row = orm
          .select()
          .from(intake)
          .where(
            and(eq(intake.projectId, projectId), eq(intake.todoId, todoId)),
          )
          .get();
        return row ? recordOf(row) : undefined;
      }),
    forProject: (projectId) =>
      gate.run(() =>
        orm
          .select()
          .from(intake)
          .where(eq(intake.projectId, projectId))
          .orderBy(asc(intake.todoId))
          .all()
          .map(recordOf),
      ),
    upsert: (record) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .insert(intake)
          .values({
            projectId: record.projectId,
            todoId: record.todoId,
            contentHash: record.contentHash,
            seenCommit: record.seenCommit,
            diagnostic: record.diagnostic,
          })
          .onConflictDoUpdate({
            target: [intake.projectId, intake.todoId],
            set: {
              contentHash: record.contentHash,
              seenCommit: record.seenCommit,
              diagnostic: record.diagnostic,
            },
          })
          .run();
      }),
  };
};
