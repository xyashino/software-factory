import { integer, text } from 'drizzle-orm/sqlite-core';

export const timestamps = () => ({
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const jsonColumn = <T>(name: string) =>
  text(name, { mode: 'json' }).$type<T>();

export const idText = <T extends string>(name: string) => text(name).$type<T>();
