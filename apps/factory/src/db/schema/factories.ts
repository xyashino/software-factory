import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { FactoryId } from '../../domain/common/brand';

export const factories = sqliteTable('factories', {
  factoryId: text('factory_id').$type<FactoryId>().primaryKey(),
  name: text('name').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  createdAt: integer('created_at').notNull(),
});
