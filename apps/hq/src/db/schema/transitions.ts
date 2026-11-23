import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ACTOR_KINDS, ENTITY_TYPES } from '@repo/hq-contracts/enums/events';
import type { ProjectId } from '../../domain/common/brand';
import { jsonColumn } from '@repo/bun-sqlite-kit/columns';
import { projects } from './projects';

export const stateTransitions = sqliteTable('state_transitions', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  projectId: text('project_id')
    .$type<ProjectId>()
    .notNull()
    .references(() => projects.projectId),
  entityType: text('entity_type', { enum: ENTITY_TYPES }).notNull(),
  entityId: text('entity_id').notNull(),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
  actorId: text('actor_id'),
  commandId: text('command_id').unique(),
  metaJson: jsonColumn<Record<string, unknown>>('meta_json'),
  at: integer('at').notNull(),
});
