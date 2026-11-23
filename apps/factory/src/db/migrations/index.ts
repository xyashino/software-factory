import { embeddedMigrationsOf as buildMigrations } from '@repo/bun-sqlite-kit/embedded-migrations';
import journal from './meta/_journal.json';
import init from './0000_init.sql' with { type: 'text' };
import cellDrainLeave from './0001_cell_drain_leave.sql' with { type: 'text' };
import factoriesLink from './0002_common_the_renegades.sql' with { type: 'text' };
import cellFactoryOwner from './0003_cell_factory_owner.sql' with { type: 'text' };

const SQL_BY_TAG: Record<string, string> = {
  '0000_init': init,
  '0001_cell_drain_leave': cellDrainLeave,
  '0002_common_the_renegades': factoriesLink,
  '0003_cell_factory_owner': cellFactoryOwner,
};

export const embeddedMigrationsOf = () =>
  buildMigrations({ journal, sqlByTag: SQL_BY_TAG });
