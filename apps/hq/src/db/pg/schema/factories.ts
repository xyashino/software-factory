import { sql } from 'drizzle-orm';
import { epochMs, jsonColumn } from './columns';
import { pgTable, text } from 'drizzle-orm/pg-core';
import type { FactoryId } from '../../../domain/common/brand';
import type { FactoryProjectReport } from '../../../domain/common/vocabulary';

export const factories = pgTable('factories', {
  factoryId: text('factory_id').$type<FactoryId>().primaryKey(),
  name: text('name').notNull(),
  projectsJson: jsonColumn<FactoryProjectReport[]>('projects_json')
    .notNull()
    .default(sql`'[]'::jsonb`),
  lastSeenAt: epochMs('last_seen_at').notNull(),
  createdAt: epochMs('created_at').notNull(),
});
