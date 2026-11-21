import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type {
  IncidentId,
  JobId,
  OrderId,
  ProjectId,
  StepId,
} from '../../domain/common/brand';
import { orderSteps, workOrders } from './orders';
import { projects } from './projects';
import { jobs } from './jobs';

export const INCIDENT_REASONS = [
  'line_unavailable',
  'step_retries_exhausted',
  'operator_blocked',
  'workspace_failed',
  'worktree_reset_limit',
  'delivery_failed',
  'parent_rebased',
] as const;

export const INCIDENT_STATUSES = [
  'open',
  'triaging',
  'resolved',
  'escalated',
  'cancelled',
] as const;

export const incidents = sqliteTable('incidents', {
  incidentId: text('incident_id').$type<IncidentId>().primaryKey(),
  projectId: text('project_id')
    .$type<ProjectId>()
    .notNull()
    .references(() => projects.projectId),
  orderId: text('order_id')
    .$type<OrderId>()
    .notNull()
    .references(() => workOrders.orderId),
  failedStepId: text('failed_step_id')
    .$type<StepId>()
    .references(() => orderSteps.stepId),
  failedJobId: text('failed_job_id')
    .$type<JobId>()
    .references((): AnySQLiteColumn => jobs.jobId),
  reason: text('reason', { enum: INCIDENT_REASONS }).notNull(),
  detail: text('detail').notNull(),
  status: text('status', { enum: INCIDENT_STATUSES }).notNull(),
  triageOwner: text('triage_owner', {
    enum: ['mechanic', 'supervisor'],
  }).notNull(),
  diagnosis: text('diagnosis'),
  resolutionAction: text('resolution_action', {
    enum: [
      'retry_step',
      'restart_from_step',
      'restart_from_scratch',
      'escalate',
      'cancel',
    ],
  }),
  resolvedBy: text('resolved_by'),
  createdAt: integer('created_at').notNull(),
  resolvedAt: integer('resolved_at'),
});
