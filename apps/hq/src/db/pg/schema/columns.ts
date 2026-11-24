import { bigint, jsonb } from 'drizzle-orm/pg-core';

export const epochMs = (name: string) => bigint(name, { mode: 'number' });

export const timestamps = () => ({
  createdAt: epochMs('created_at').notNull(),
  updatedAt: epochMs('updated_at').notNull(),
});

export const jsonColumn = <T>(name: string) => jsonb(name).$type<T>();
