import { createHash } from 'node:crypto';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import journal from './meta/_journal.json';
import init from './0000_init.sql' with { type: 'text' };
import factoryProfiles from './0001_hot_lucky_pierre.sql' with { type: 'text' };
import cellSlotRuntime from './0002_cell-slot-runtime.sql' with { type: 'text' };

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const SQL_BY_TAG: Record<string, string> = {
  '0000_init': init,
  '0001_hot_lucky_pierre': factoryProfiles,
  '0002_cell-slot-runtime': cellSlotRuntime,
};

interface JournalEntry {
  tag: string;
  when: number;
  breakpoints: boolean;
}

const sqlOf = (tag: string): string => {
  const query = SQL_BY_TAG[tag];
  if (query === undefined) {
    throw new Error(`no embedded SQL for migration ${tag}`);
  }
  return query;
};

const migrationOf = ({
  tag,
  when,
  breakpoints,
}: JournalEntry): MigrationMeta => {
  const query = sqlOf(tag);
  return {
    sql: query.split(STATEMENT_BREAKPOINT),
    bps: breakpoints,
    folderMillis: when,
    hash: createHash('sha256').update(query).digest('hex'),
  };
};

export const embeddedMigrationsOf = (): MigrationMeta[] =>
  journal.entries.map(migrationOf);
