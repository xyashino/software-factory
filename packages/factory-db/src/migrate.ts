import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The migrations generated from `src/schema.ts` by drizzle-kit (STORAGE §9): the baseline, then every
 * later change. Applied in the order of `meta/_journal.json`.
 */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL('../drizzle', import.meta.url),
);

/**
 * The hand-written files 0001-0003, frozen (STORAGE §9). A database created before them still needs
 * them, in this order, before it adopts the baseline. Never edited, never extended.
 */
export const LEGACY_MIGRATIONS_DIR = fileURLToPath(
  new URL('../migrations', import.meta.url),
);

const LEGACY_NAMES = [
  '0001_init.sql',
  '0002_join_token_command_id.sql',
  '0003_order_plan.sql',
] as const;

/** drizzle-kit separates the statements of one migration file with this line. */
const BREAKPOINT = '--> statement-breakpoint';

interface Step {
  name: string;
  statements: string[];
}

interface Journal {
  entries: { tag: string }[];
}

// raw: the migration runner is the one raw-SQL module. `schema_migrations` is its own bookkeeping table,
// not a domain table, so it stays outside `schema.ts`; the transaction control below is raw too (STORAGE §3.1).
const CREATE_HISTORY =
  'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)';

/** The journal's steps in order, each with the statements of its `<tag>.sql` file. */
const journalSteps = (dir: string): Step[] => {
  const journal = JSON.parse(
    readFileSync(join(dir, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  return journal.entries.map(({ tag }) => ({
    name: tag,
    statements: readFileSync(join(dir, `${tag}.sql`), 'utf8')
      .split(BREAKPOINT)
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0),
  }));
};

const legacySteps = (): Step[] =>
  LEGACY_NAMES.map((name) => ({
    name,
    statements: [readFileSync(join(LEGACY_MIGRATIONS_DIR, name), 'utf8')],
  }));

const appliedNames = (db: Database): Set<string> =>
  new Set(
    db
      .query<{ name: string }, []>('SELECT name FROM schema_migrations')
      .all()
      .map((row) => row.name),
  );

const hasTables = (db: Database): boolean =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'",
    )
    .all().length > 0;

/**
 * Applies every pending migration in `dir`, forward only, in one `BEGIN IMMEDIATE` transaction. Each
 * is recorded in `schema_migrations` under its journal tag. A failure rolls the whole batch back. An
 * applied name that is neither in `dir` nor a legacy file is an error: history is not rewritten.
 *
 * A database that predates the baseline (its history holds 0001-0003, a prefix of them) first runs
 * the missing legacy files, in order, then records the baseline as applied without executing it. The
 * baseline's tables already exist there. Any other unknown state is refused.
 *
 * Returns the names executed by this call (empty on a re-run). The baseline is not in it when adopted.
 */
export const migrate = (
  db: Database,
  dir: string = MIGRATIONS_DIR,
): string[] => {
  const steps = journalSteps(dir);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(CREATE_HISTORY);
    const applied = appliedNames(db);
    const known = new Set([...steps.map((step) => step.name), ...LEGACY_NAMES]);
    const missing = [...applied].filter((name) => !known.has(name)).sort();
    if (missing.length > 0) {
      throw new Error(
        `applied migrations missing from ${dir}: ${missing.join(', ')}`,
      );
    }

    const executed: string[] = [];
    const record = (name: string): void => {
      db.run('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [
        name,
        Date.now(),
      ]);
      applied.add(name);
    };
    const run = (step: Step): void => {
      for (const statement of step.statements) db.exec(statement);
      record(step.name);
      executed.push(step.name);
    };

    const baseline = steps[0];
    if (baseline && !applied.has(baseline.name)) {
      const legacy = LEGACY_NAMES.filter((name) => applied.has(name));
      const unexpected = [...applied].filter(
        (name) => !(LEGACY_NAMES as readonly string[]).includes(name),
      );
      if (legacy.length === 0) {
        if (applied.size > 0) {
          throw new Error(
            `unknown migration state: ${[...applied].join(', ')} applied without ${baseline.name}`,
          );
        }
        if (hasTables(db)) {
          throw new Error(
            'unknown migration state: tables exist without a migration history',
          );
        }
      } else {
        const prefix = LEGACY_NAMES.slice(0, legacy.length);
        if (
          unexpected.length > 0 ||
          legacy.some((name, index) => name !== prefix[index])
        ) {
          throw new Error(
            `unknown legacy migration state: ${[...applied].sort().join(', ')}; expected a prefix of ${LEGACY_NAMES.join(', ')}`,
          );
        }
        for (const step of legacySteps()) {
          if (!applied.has(step.name)) run(step);
        }
        record(baseline.name);
      }
    }

    for (const step of steps) {
      if (!applied.has(step.name)) run(step);
    }
    db.exec('COMMIT');
    return executed;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
};
