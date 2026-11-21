import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { CellId, JobId, ProjectId } from '../../domain/common/brand';
import { jsonColumn } from '../columns';
import { projects } from './projects';

export const CELL_STATUSES = [
  'online',
  'busy',
  'draining',
  'left',
  'offline',
  'revoked',
] as const;

export const cells = sqliteTable('cells', {
  cellId: text('cell_id').$type<CellId>().primaryKey(),
  name: text('name').notNull(),
  projectId: text('project_id')
    .$type<ProjectId>()
    .notNull()
    .references(() => projects.projectId),
  allowedLinesJson: jsonColumn<string[]>('allowed_lines_json').notNull(),
  status: text('status', { enum: CELL_STATUSES }).notNull(),
  runnersJson: jsonColumn<string[]>('runners_json').notNull(),
  localWorktreesJson: jsonColumn<LocalWorktree[]>(
    'local_worktrees_json',
  ).notNull(),
  activeJobId: text('active_job_id').$type<JobId>(),
  drainForce: integer('drain_force', { mode: 'boolean' })
    .notNull()
    .default(false),
  lastHeartbeatAt: integer('last_heartbeat_at'),
  createdAt: integer('created_at').notNull(),
  revokedAt: integer('revoked_at'),
});

export type LocalWorktree = { orderId: string; completedStepIds: string[] };
