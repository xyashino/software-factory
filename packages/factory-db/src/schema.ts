import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * The Drizzle view of `migrations/0001_init.sql` (STORAGE §4). The SQL files are the source of truth
 * for the schema; this module only mirrors them for typed queries. The parity test in
 * `__tests__/schema.test.ts` fails when the two drift. Pure declarations: no domain logic here.
 */

export const projects = sqliteTable('projects', {
  projectId: text('project_id').primaryKey(),
  repoUrl: text('repo_url').notNull(),
  baseBranch: text('base_branch').notNull().default('main'),
  maxRunning: integer('max_running').notNull().default(2),
  depPolicy: text('dep_policy', { enum: ['delivered', 'merged'] })
    .notNull()
    .default('delivered'),
  createdAt: integer('created_at').notNull(),
});

export const events = sqliteTable(
  'events',
  {
    globalSeq: integer('global_seq').primaryKey({ autoIncrement: true }),
    orderId: text('order_id').notNull(),
    seq: integer('seq').notNull(),
    at: integer('at').notNull(),
    /** JSON. */
    actor: text('actor').notNull(),
    commandId: text('command_id').notNull(),
    epoch: integer('epoch'),
    schemaVersion: integer('schema_version').notNull(),
    type: text('type').notNull(),
    /** JSON, validated by zod. */
    payload: text('payload').notNull(),
  },
  (table) => [
    unique('events_order_seq').on(table.orderId, table.seq),
    index('events_type').on(table.type),
  ],
);

export const orders = sqliteTable(
  'orders',
  {
    orderId: text('order_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId),
    todoId: text('todo_id').notNull(),
    title: text('title').notNull(),
    line: text('line').notNull(),
    priority: text('priority').notNull(),
    /** JSON array of order ids. */
    dependsOn: text('depends_on').notNull(),
    lastSeq: integer('last_seq').notNull(),
    /** Board status (CORE §4.2), before dependency overlay. */
    status: text('status').notNull(),
    /** 'queue' | 'cell' | 'supervisor' | 'none'. */
    holder: text('holder').notNull(),
    /** CORE §6 Next.kind. */
    nextKind: text('next_kind').notNull(),
    /** When next_kind = 'job'. */
    jobKind: text('job_kind'),
    /** When the next job is an Operator station. */
    runner: text('runner'),
    /** JSON array, the next Station's `requires`. */
    requiredCapabilities: text('required_capabilities').notNull().default('[]'),
    stationId: text('station_id'),
    stationIndex: integer('station_index'),
    /** 0/1. */
    progressed: integer('progressed').notNull(),
    /** 0/1, a resume or reopen waits to run. */
    resumed: integer('resumed').notNull(),
    lastCellId: text('last_cell_id'),
    /** JSON [{ cellId, until }]. */
    avoidCells: text('avoid_cells').notNull().default('[]'),
    andonReason: text('andon_reason'),
    prUrl: text('pr_url'),
    prState: text('pr_state'),
    createdAt: integer('created_at').notNull(),
    /** `at` of the last event. */
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    unique('orders_project_todo').on(table.projectId, table.todoId),
    index('orders_queue').on(
      table.holder,
      table.nextKind,
      table.priority,
      table.createdAt,
    ),
  ],
);

export const commands = sqliteTable('commands', {
  commandId: text('command_id').primaryKey(),
  orderId: text('order_id').notNull(),
  firstSeq: integer('first_seq'),
  lastSeq: integer('last_seq'),
  response: text('response').notNull(),
  at: integer('at').notNull(),
});

export const joinTokens = sqliteTable(
  'join_tokens',
  {
    joinTokenId: text('join_token_id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
    /** The create command that made the token (migration 0002); null before it. */
    commandId: text('command_id'),
  },
  (table) => [uniqueIndex('join_tokens_command_id').on(table.commandId)],
);

export const cells = sqliteTable('cells', {
  cellId: text('cell_id').primaryKey(),
  name: text('name').notNull(),
  /** Hash of the Cell credential. */
  tokenHash: text('token_hash').notNull(),
  joinedWith: text('joined_with').references(() => joinTokens.joinTokenId),
  joinedAt: integer('joined_at').notNull(),
  revokedAt: integer('revoked_at'),
  lastSeenAt: integer('last_seen_at'),
  /** JSON from /hello: version, projects, runners, capabilities, slots. */
  info: text('info'),
});

export const leases = sqliteTable(
  'leases',
  {
    /** One active job per Work order (I4). */
    orderId: text('order_id').primaryKey(),
    jobId: text('job_id').notNull().unique(),
    cellId: text('cell_id')
      .notNull()
      .references(() => cells.cellId),
    epoch: integer('epoch').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('leases_expiry').on(table.expiresAt)],
);

export const signals = sqliteTable('signals', {
  signalId: text('signal_id').primaryKey(),
  jobId: text('job_id').notNull(),
  kind: text('kind').notNull(),
  payload: text('payload').notNull(),
  createdAt: integer('created_at').notNull(),
  ackedAt: integer('acked_at'),
});

export const blobs = sqliteTable('blobs', {
  /** sha256:<hex> of the uncompressed bytes. */
  ref: text('ref').primaryKey(),
  size: integer('size').notNull(),
  /** 'identity' | 'gzip'. */
  encoding: text('encoding').notNull(),
  content: blob('content', { mode: 'buffer' }).notNull(),
  /** 'text/markdown', 'text/plain', 'application/json'. */
  mediaType: text('media_type').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const supervisorTokens = sqliteTable('supervisor_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const intake = sqliteTable(
  'intake',
  {
    projectId: text('project_id').notNull(),
    todoId: text('todo_id').notNull(),
    contentHash: text('content_hash').notNull(),
    seenCommit: text('seen_commit').notNull(),
    /** e.g. unparseable frontmatter, reused id. */
    diagnostic: text('diagnostic'),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.todoId] })],
);

export type ProjectRecord = typeof projects.$inferSelect;
export type NewProjectRecord = typeof projects.$inferInsert;
export type EventRecord = typeof events.$inferSelect;
export type NewEventRecord = typeof events.$inferInsert;
export type OrderRecord = typeof orders.$inferSelect;
export type NewOrderRecord = typeof orders.$inferInsert;
export type CommandRecord = typeof commands.$inferSelect;
export type NewCommandRecord = typeof commands.$inferInsert;
export type JoinTokenRecord = typeof joinTokens.$inferSelect;
export type NewJoinTokenRecord = typeof joinTokens.$inferInsert;
export type CellRecord = typeof cells.$inferSelect;
export type NewCellRecord = typeof cells.$inferInsert;
export type LeaseRecord = typeof leases.$inferSelect;
export type NewLeaseRecord = typeof leases.$inferInsert;
export type SignalRecord = typeof signals.$inferSelect;
export type NewSignalRecord = typeof signals.$inferInsert;
export type BlobRecord = typeof blobs.$inferSelect;
export type NewBlobRecord = typeof blobs.$inferInsert;
export type SupervisorTokenRecord = typeof supervisorTokens.$inferSelect;
export type NewSupervisorTokenRecord = typeof supervisorTokens.$inferInsert;
export type IntakeRecord = typeof intake.$inferSelect;
export type NewIntakeRecord = typeof intake.$inferInsert;
