import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { embeddedMigrationsOf } from '../embedded-migrations';

export const items = sqliteTable('items', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});

export const schema = { items };

const INIT_SQL =
  'CREATE TABLE `items` (`id` integer PRIMARY KEY NOT NULL, `name` text NOT NULL);\n--> statement-breakpoint\nCREATE TABLE `notes` (`id` integer PRIMARY KEY NOT NULL);';

export const migrations = embeddedMigrationsOf({
  journal: {
    entries: [{ tag: '0000_init', when: 1700000000000, breakpoints: true }],
  },
  sqlByTag: { '0000_init': INIT_SQL },
});
