import { createHash } from 'node:crypto';
import type { MigrationMeta } from 'drizzle-orm/migrator';

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

export type JournalEntry = {
  tag: string;
  when: number;
  breakpoints: boolean;
};

export type EmbeddedMigrationsInput = {
  journal: { entries: JournalEntry[] };
  sqlByTag: Record<string, string>;
};

const sqlOf = (tag: string, sqlByTag: Record<string, string>): string => {
  const query = sqlByTag[tag];
  if (query === undefined) {
    throw new Error(`no embedded SQL for migration ${tag}`);
  }
  return query;
};

const migrationOf = (
  entry: JournalEntry,
  sqlByTag: Record<string, string>,
): MigrationMeta => {
  const query = sqlOf(entry.tag, sqlByTag);
  return {
    sql: query.split(STATEMENT_BREAKPOINT),
    bps: entry.breakpoints,
    folderMillis: entry.when,
    hash: createHash('sha256').update(query).digest('hex'),
  };
};

export const embeddedMigrationsOf = ({
  journal,
  sqlByTag,
}: EmbeddedMigrationsInput): MigrationMeta[] =>
  journal.entries.map((entry) => migrationOf(entry, sqlByTag));
