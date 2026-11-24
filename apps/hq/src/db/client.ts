import {
  type BunSqliteDb,
  createDb as createKitDb,
} from '@repo/bun-sqlite-kit/create-db';
import { factories } from './schema/factories';
import { incidents } from './schema/incidents';
import { jobs } from './schema/jobs';
import { orderPlans } from './schema/plans';
import { orderSteps, workOrders } from './schema/orders';
import { projects } from './schema/projects';
import { safeTokens } from './schema/tokens';
import { stateTransitions } from './schema/transitions';
import { embeddedMigrationsOf } from './migrations';

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

export type Db = BunSqliteDb<typeof schema>;

export const createDb = (sqlitePath: string): Db =>
  createKitDb(sqlitePath, { schema, migrations: embeddedMigrationsOf() });
