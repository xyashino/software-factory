import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ProjectId } from '../../domain/common/brand';
import { timestamps } from '../columns';

export const projects = sqliteTable('projects', {
  projectId: text('project_id').$type<ProjectId>().primaryKey(),
  repoUrl: text('repo_url').notNull(),
  defaultBaseBranch: text('default_base_branch').notNull(),
  maxRunning: integer('max_running').notNull(),
  ...timestamps(),
});
