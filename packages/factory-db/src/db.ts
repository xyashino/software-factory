import type { Database } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema';

/**
 * The typed query layer over one `bun:sqlite` connection. Drizzle only builds and runs queries on
 * that connection; `BEGIN IMMEDIATE`, `COMMIT`, `ROLLBACK` and savepoints stay raw on the `Database`
 * (never `orm.transaction`, which would start a plain `BEGIN`). See STORAGE §3.1.
 */
export type FactoryDatabase = BunSQLiteDatabase<typeof schema>;

/** A Drizzle view of `db`. Cheap: it wraps the handle and owns no state of its own. */
export const drizzleOf = (db: Database): FactoryDatabase =>
  drizzle(db, { schema });
