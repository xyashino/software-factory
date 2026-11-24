import { pgTable, text, type AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  INCIDENT_REASONS,
  INCIDENT_STATUSES,
} from '@repo/hq-contracts/enums/incidents';
import type {
  IncidentId,
  JobId,
  OrderId,
  ProjectId,
  StepId,
} from '../../../domain/common/brand';
import { epochMs } from './columns';
import { jobs } from './jobs';
import { orderSteps, workOrders } from './orders';
import { projects } from './projects';

export const incidents = pgTable('incidents', {
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
    .references((): AnyPgColumn => jobs.jobId),
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
  createdAt: epochMs('created_at').notNull(),
  resolvedAt: epochMs('resolved_at'),
});
