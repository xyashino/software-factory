import { embeddedMigrationsOf as buildMigrations } from '@repo/bun-sqlite-kit/embedded-migrations';
import journal from './meta/_journal.json';
import init from './0000_init_postgres.sql' with { type: 'text' };
import transitionActorLabel from './0001_transition_actor_label.sql' with { type: 'text' };

const SQL_BY_TAG: Record<string, string> = {
  '0000_init_postgres': init,
  '0001_transition_actor_label': transitionActorLabel,
};

export const embeddedMigrationsOf = () =>
  buildMigrations({ journal, sqlByTag: SQL_BY_TAG });
