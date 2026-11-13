import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Mirrors `migrations/*.sql`. The SQL migrations stay the source of truth for the schema. */
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  workflow: text('workflow').notNull(),
  todoPath: text('todo_path').notNull(),
  branch: text('branch').notNull(),
  /** Projection of TaskState.status, for listing only. */
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const events = sqliteTable(
  'events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id),
    attemptId: text('attempt_id'),
    type: text('type').notNull(),
    /** JSON of the whole event, validated with zod on read. */
    payload: text('payload').notNull(),
    at: integer('at').notNull(),
  },
  (table) => [
    index('events_task').on(table.taskId, table.seq),
    index('events_attempt').on(table.taskId, table.attemptId),
  ],
);

export type TaskRecord = typeof tasks.$inferSelect;
export type NewTaskRecord = typeof tasks.$inferInsert;
export type EventRecord = typeof events.$inferSelect;
export type NewEventRecord = typeof events.$inferInsert;
