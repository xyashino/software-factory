import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { WORK_ORDER_STATES } from '@repo/hq-contracts/enums/orders';
import type {
  CellId,
  FactoryId,
  OrderId,
  PlanId,
  ProjectId,
  StepId,
} from '../../domain/common/brand';
import { jsonColumn, timestamps } from '@repo/bun-sqlite-kit/columns';
import { factories } from './factories';
import { orderPlans } from './plans';
import { projects } from './projects';

export const ORDER_STEP_STATES = [
  'pending',
  'ready',
  'claimed',
  'running',
  'passed',
  'failed',
  'blocked',
  'cancelled',
] as const;

export const workOrders = sqliteTable(
  'work_orders',
  {
    orderId: text('order_id').$type<OrderId>().primaryKey(),
    projectId: text('project_id')
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.projectId),
    planId: text('plan_id')
      .$type<PlanId>()
      .references(() => orderPlans.planId),
    parentOrderId: text('parent_order_id')
      .$type<OrderId>()
      .references((): AnySQLiteColumn => workOrders.orderId),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    type: text('type', {
      enum: ['feat', 'fix', 'refactor', 'chore', 'docs', 'test'],
    }).notNull(),
    description: text('description').notNull(),
    lineName: text('line_name').notNull(),
    lineSnapshotJson: jsonColumn<unknown>('line_snapshot_json'),
    unavailableLineFactoriesJson: jsonColumn<string[]>(
      'unavailable_line_factories_json',
    ).notNull(),
    priority: text('priority', { enum: ['high', 'medium', 'low'] }).notNull(),
    baseBranch: text('base_branch').notNull(),
    baseCommitSha: text('base_commit_sha'),
    branch: text('branch').notNull(),
    headCommitSha: text('head_commit_sha'),
    staleBase: integer('stale_base').notNull().default(0),
    state: text('state', { enum: WORK_ORDER_STATES }).notNull(),
    currentStepIndex: integer('current_step_index').notNull().default(0),
    pinnedFactoryId: text('pinned_factory_id')
      .$type<FactoryId>()
      .references(() => factories.factoryId),
    worktreeResets: integer('worktree_resets').notNull().default(0),
    mechanicRuns: integer('mechanic_runs').notNull().default(0),
    activeJobId: text('active_job_id').unique(),
    activeCellId: text('active_cell_id').$type<CellId>(),
    epoch: integer('epoch').notNull().default(0),
    version: integer('version').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('idx_work_orders_one_active_per_cell')
      .on(table.activeCellId)
      .where(sql`${table.activeCellId} IS NOT NULL`),
  ],
);

export const orderSteps = sqliteTable('order_steps', {
  stepId: text('step_id').$type<StepId>().primaryKey(),
  orderId: text('order_id')
    .$type<OrderId>()
    .notNull()
    .references(() => workOrders.orderId),
  stepIndex: integer('step_index').notNull(),
  stationId: text('station_id').notNull(),
  kind: text('kind', { enum: ['operator', 'inspection', 'deliver'] }).notNull(),
  runner: text('runner'),
  configJson: jsonColumn<Record<string, unknown>>('config_json').notNull(),
  requiredFilesJson: jsonColumn<string[]>('required_files_json').notNull(),
  producedFilesJson: jsonColumn<string[]>('produced_files_json').notNull(),
  state: text('state', { enum: ORDER_STEP_STATES }).notNull(),
  attemptsUsed: integer('attempts_used').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull(),
  onFailRetryStationId: text('on_fail_retry_station_id'),
  lastCommitSha: text('last_commit_sha'),
  lastOutputJson: jsonColumn<unknown>('last_output_json'),
  updatedAt: integer('updated_at').notNull(),
});
