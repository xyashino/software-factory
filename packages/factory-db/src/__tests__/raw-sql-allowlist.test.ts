import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A raw statement call on the connection handle: `db.run(`, `db.query<`, `db.prepare(`, `db.exec(`
 * and the same on `raw` (savepoints). Matched across lines, so a chained `db\n  .query<` counts too.
 * Drizzle calls (`orm.`, `gate.run`, `.run()` on a builder) never match.
 */
const RAW_CALL = /\b(?:db|raw)\s*\.\s*(?:run|query|prepare|exec)\s*[(<]/g;

const rawCalls = (code: string): number => code.match(RAW_CALL)?.length ?? 0;

/**
 * The raw calls that remain under src/, per file, with the reason Drizzle cannot express them. The
 * counts are exact: a new raw call, or a removed one, fails this test until the entry is updated.
 */
const ALLOWLIST: Record<string, { calls: number; why: string }> = {
  'archive.ts': {
    calls: 1,
    why: 'VACUUM INTO takes its file name as a bound parameter; no Drizzle builder',
  },
  'migrate.ts': {
    calls: 8,
    why: 'migration runner: its own schema_migrations table and BEGIN/COMMIT/ROLLBACK',
  },
  'sqlite-event-store.ts': {
    calls: 11,
    why: 'connection pragmas, BEGIN IMMEDIATE / COMMIT / ROLLBACK and savepoints (STORAGE §3.1)',
  },
};

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Non-test source files directly under src/ (tests may use raw SQL to build fixtures). */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });

describe('raw SQL allowlist (STORAGE §3, §3.1)', () => {
  it('counts raw calls in fixtures the way the scan expects', () => {
    expect(rawCalls("db.run('DELETE FROM cells')")).toBe(1);
    expect(rawCalls('db.query<Row, []>("SELECT 1").all()')).toBe(1);
    expect(rawCalls('db.prepare("SELECT 1")')).toBe(1);
    expect(rawCalls("raw.exec('SAVEPOINT append')")).toBe(1);
    expect(rawCalls('db\n  .query<Row, []>("SELECT 1")')).toBe(1);
  });

  it('does not count Drizzle or gate calls', () => {
    expect(
      rawCalls(
        'gate.run(() => 1); writes.run(async () => 2); orm.insert(t).values(v).run(); orm.delete(t).run();',
      ),
    ).toBe(0);
  });

  it('lists only files that still exist under src/', () => {
    for (const file of Object.keys(ALLOWLIST)) {
      expect(existsSync(join(SRC_DIR, file)), file).toBe(true);
    }
  });

  it('gives every allowlisted file a reason', () => {
    for (const [file, entry] of Object.entries(ALLOWLIST)) {
      expect(entry.why.length, file).toBeGreaterThan(0);
    }
  });

  it('matches the allowlist count in every source file', () => {
    const actual: Record<string, number> = {};
    for (const file of sourceFiles(SRC_DIR)) {
      const calls = rawCalls(readFileSync(file, 'utf8'));
      if (calls > 0) actual[file.slice(SRC_DIR.length)] = calls;
    }
    const expected = Object.fromEntries(
      Object.entries(ALLOWLIST).map(([file, entry]) => [file, entry.calls]),
    );
    expect(actual).toEqual(expected);
  });
});
