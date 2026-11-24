import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { FactoryId } from '../../domain/common/brand';
import type { FactoryProjectReport } from '../../domain/common/vocabulary';
import { jsonColumn } from '@repo/bun-sqlite-kit/columns';

export const factories = sqliteTable('factories', {
  factoryId: text('factory_id').$type<FactoryId>().primaryKey(),
  name: text('name').notNull(),
  projectsJson: jsonColumn<FactoryProjectReport[]>('projects_json')
    .notNull()
    .default(sql`'[]'`),
  lastSeenAt: integer('last_seen_at').notNull(),
  createdAt: integer('created_at').notNull(),
});
