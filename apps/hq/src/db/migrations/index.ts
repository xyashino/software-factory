import { embeddedMigrationsOf as buildMigrations } from '@repo/bun-sqlite-kit/embedded-migrations';
import journal from './meta/_journal.json';
import init from './0000_init.sql' with { type: 'text' };
import cellDrainLeave from './0001_cell_drain_leave.sql' with { type: 'text' };
import factoriesLink from './0002_common_the_renegades.sql' with { type: 'text' };
import cellFactoryOwner from './0003_cell_factory_owner.sql' with { type: 'text' };
import cellGone from './0004_cell_gone.sql' with { type: 'text' };
import cellIdentityAdd from './0005_cell_identity_add.sql' with { type: 'text' };
import cellIdentityDrop from './0006_cell_identity_drop.sql' with { type: 'text' };
import transitionActorLabel from './0007_transition_actor_label.sql' with { type: 'text' };

const SQL_BY_TAG: Record<string, string> = {
  '0000_init': init,
  '0001_cell_drain_leave': cellDrainLeave,
  '0002_common_the_renegades': factoriesLink,
  '0003_cell_factory_owner': cellFactoryOwner,
  '0004_cell_gone': cellGone,
  '0005_cell_identity_add': cellIdentityAdd,
  '0006_cell_identity_drop': cellIdentityDrop,
  '0007_transition_actor_label': transitionActorLabel,
};

export const embeddedMigrationsOf = () =>
  buildMigrations({ journal, sqlByTag: SQL_BY_TAG });
