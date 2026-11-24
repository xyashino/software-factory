import { SQL } from 'bun';
import { type BunSQLDatabase, drizzle } from 'drizzle-orm/bun-sql';
import type { PgDialect, PgSession } from 'drizzle-orm/pg-core';
import { embeddedMigrationsOf } from './migrations';
import { factories } from './schema/factories';
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
  factories,
  orderPlans,
  workOrders,
  orderSteps,
  jobs,
  incidents,
  stateTransitions,
};

const MIGRATION_LOCK_ID = 727_001;

export type PgDb = BunSQLDatabase<typeof schema>;

export type PgTx = Parameters<Parameters<PgDb['transaction']>[0]>[0];

type InternalMigrator = {
  dialect: PgDialect;
  session: PgSession;
};

// One session holds the advisory lock, so concurrent HQ starts apply each
// migration once; the lock needs the same connection as the migration run.
const migrate = async (databaseUrl: string): Promise<void> => {
  const client = new SQL({ url: databaseUrl, max: 1 });
  try {
    const db = drizzle({ client, schema: {} });
    const { dialect, session } = db as unknown as InternalMigrator;
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    try {
      await dialect.migrate(
        embeddedMigrationsOf(),
        session,
        '__drizzle_migrations',
      );
    } finally {
      await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    }
  } finally {
    await client.close();
  }
};

export const createPgDb = async (databaseUrl: string): Promise<PgDb> => {
  await migrate(databaseUrl);
  return drizzle({ client: new SQL(databaseUrl), schema });
};
