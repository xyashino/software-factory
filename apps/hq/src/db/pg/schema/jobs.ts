import { integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
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
} from '../../../domain/common/brand';
import {
  JOB_KINDS,
  JOB_STATUSES,
  WORKSPACE_MODES,
} from '../../../domain/common/vocabulary';
import { epochMs, jsonColumn } from './columns';
import { factories } from './factories';
import { incidents } from './incidents';
import { orderPlans } from './plans';
import { orderSteps, workOrders } from './orders';
import { projects } from './projects';

export const jobs = pgTable(
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
      enum: WORKSPACE_MODES,
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
    leaseExpiresAt: epochMs('lease_expires_at'),
    resultCommitSha: text('result_commit_sha'),
    resultJson: jsonColumn<unknown>('result_json'),
    errorDetail: text('error_detail'),
    createdAt: epochMs('created_at').notNull(),
    startedAt: epochMs('started_at'),
    finishedAt: epochMs('finished_at'),
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
