import { Database } from 'bun:sqlite';
import { type BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { fileURLToPath } from 'node:url';
import { cells } from './schema/cells';
import { incidents } from './schema/incidents';
import { jobs } from './schema/jobs';
import { orderPlans } from './schema/plans';
import { orderSteps, workOrders } from './schema/orders';
import { projects } from './schema/projects';
import { safeTokens } from './schema/tokens';
import { stateTransitions } from './schema/transitions';

const schema = {
  projects,
  safeTokens,
  cells,
  orderPlans,
  workOrders,
  orderSteps,
  jobs,
  incidents,
  stateTransitions,
};

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

const PRAGMAS = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
  'PRAGMA busy_timeout = 5000',
];

export type Db = BunSQLiteDatabase<typeof schema>;

export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const createDb = (sqlitePath: string): Db => {
  const sqlite = new Database(sqlitePath);
  for (const pragma of PRAGMAS) sqlite.exec(pragma);
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
};

export const immediateTx = <T>(db: Db, fn: (tx: DbTx) => T): T =>
  db.transaction(fn, { behavior: 'immediate' });
