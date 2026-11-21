import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { PlanId, ProjectId } from '../../domain/common/brand';
import { timestamps } from '../columns';
import { projects } from './projects';

export const PLAN_STATES = [
  'draft',
  'branching',
  'active',
  'ready',
  'completed',
  'failed',
  'cancelled',
] as const;

export const orderPlans = sqliteTable('order_plans', {
  planId: text('plan_id').$type<PlanId>().primaryKey(),
  projectId: text('project_id')
    .$type<ProjectId>()
    .notNull()
    .references(() => projects.projectId),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  baseBranch: text('base_branch').notNull(),
  branch: text('branch').notNull(),
  branchCommitSha: text('branch_commit_sha'),
  state: text('state', { enum: PLAN_STATES }).notNull(),
  failureDetail: text('failure_detail'),
  version: integer('version').notNull(),
  ...timestamps(),
});
