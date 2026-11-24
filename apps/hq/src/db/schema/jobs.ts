import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type {
  CellId,
  FactoryId,
  IncidentId,
  JobId,
  OrderId,
  PlanId,
  ProjectId,
  StepId,
} from '../../domain/common/brand';
import { jsonColumn } from '@repo/bun-sqlite-kit/columns';
import { JOB_KINDS } from '@repo/hq-contracts/enums/jobs';
import { incidents } from './incidents';
import { orderPlans } from './plans';
import { orderSteps, workOrders } from './orders';
import { projects } from './projects';
import { factories } from './factories';

export const JOB_STATUSES = [
  'ready',
  'claimed',
  'running',
  'passed',
  'failed',
  'blocked',
  'line_unavailable',
  'lost',
  'cancelled',
] as const;

export const jobs = sqliteTable(
  'jobs',
  {
    jobId: text('job_id').$type<JobId>().primaryKey(),
    projectId: text('project_id')
      .$type<ProjectId>()
      .notNull()
      .references(() => projects.projectId),
    planId: text('plan_id')
      .$type<PlanId>()
      .references(() => orderPlans.planId),
    orderId: text('order_id')
      .$type<OrderId>()
      .references(() => workOrders.orderId),
    stepId: text('step_id')
      .$type<StepId>()
      .references(() => orderSteps.stepId),
    incidentId: text('incident_id')
      .$type<IncidentId>()
      .references(() => incidents.incidentId),
    lineName: text('line_name'),
    kind: text('kind', { enum: JOB_KINDS }).notNull(),
    workspaceMode: text('workspace_mode', {
      enum: ['fresh', 'reuse'],
    }).notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull(),
    repoUrl: text('repo_url').notNull(),
    baseBranch: text('base_branch').notNull(),
    baseCommitSha: text('base_commit_sha'),
    targetBranch: text('target_branch').notNull(),
    expectedPriorStepsJson: jsonColumn<
      {
        stepId: string;
        stationId: string;
        stepIndex: number;
        requiredFiles: string[];
      }[]
    >('expected_prior_steps_json').notNull(),
    payloadJson: jsonColumn<Record<string, unknown>>('payload_json').notNull(),
    claimedByCellId: text('claimed_by_cell_id').$type<CellId>(),
    claimedByFactoryId: text('claimed_by_factory_id')
      .$type<FactoryId>()
      .references(() => factories.factoryId),
    epoch: integer('epoch').notNull().default(0),
    leaseExpiresAt: integer('lease_expires_at'),
    resultCommitSha: text('result_commit_sha'),
    resultJson: jsonColumn<unknown>('result_json'),
    errorDetail: text('error_detail'),
    createdAt: integer('created_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (table) => [
    uniqueIndex('idx_jobs_one_active_per_order')
      .on(table.orderId)
      .where(
        sql`${table.orderId} IS NOT NULL AND ${table.status} IN ('claimed', 'running')`,
      ),
    uniqueIndex('idx_jobs_one_active_per_cell')
      .on(table.claimedByCellId)
      .where(
        sql`${table.claimedByCellId} IS NOT NULL AND ${table.status} IN ('claimed', 'running')`,
      ),
  ],
);
