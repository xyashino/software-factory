import { sql } from 'drizzle-orm';
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { FactoryId } from '../../domain/common/brand';
import { idText, timestamps } from '../columns';

export const factories = sqliteTable(
  'factories',
  {
    factoryId: idText<FactoryId>('factory_id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    joinToken: text('join_token'),
    supervisorToken: text('supervisor_token'),
    isDefault: integer('is_default', { mode: 'boolean' })
      .notNull()
      .default(false),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('idx_factories_name').on(table.name),
    uniqueIndex('idx_factories_one_default')
      .on(table.isDefault)
      .where(sql`${table.isDefault} = 1`),
  ],
);
