import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { PLAN_STATES } from '@repo/factory-contracts/enums/orders';
import type { PlanId, ProjectId } from '../../domain/common/brand';
import { timestamps } from '@repo/bun-sqlite-kit/columns';
import { projects } from './projects';

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
