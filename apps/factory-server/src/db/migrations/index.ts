import { createHash } from 'node:crypto';
import type { MigrationMeta } from 'drizzle-orm/migrator';
import journal from './meta/_journal.json';
import init from './0000_init.sql' with { type: 'text' };
import cellDrainLeave from './0001_cell_drain_leave.sql' with { type: 'text' };

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

const SQL_BY_TAG: Record<string, string> = {
  '0000_init': init,
  '0001_cell_drain_leave': cellDrainLeave,
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
