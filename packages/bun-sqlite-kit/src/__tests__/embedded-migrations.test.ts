import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { embeddedMigrationsOf } from '../embedded-migrations';

const QUERY =
  'CREATE TABLE a (id);\n--> statement-breakpoint\nCREATE TABLE b (id);';

describe('embeddedMigrationsOf', () => {
  it('splits SQL on statement breakpoints and hashes the full query', () => {
    const [migration] = embeddedMigrationsOf({
      journal: {
        entries: [{ tag: '0000_init', when: 1700, breakpoints: true }],
      },
      sqlByTag: { '0000_init': QUERY },
    });

    expect(migration?.sql).toEqual([
      'CREATE TABLE a (id);\n',
      '\nCREATE TABLE b (id);',
    ]);
    expect(migration?.bps).toBe(true);
    expect(migration?.folderMillis).toBe(1700);
    expect(migration?.hash).toBe(
      createHash('sha256').update(QUERY).digest('hex'),
    );
  });

  it('keeps journal order for several migrations', () => {
    const migrations = embeddedMigrationsOf({
      journal: {
        entries: [
          { tag: '0000_init', when: 1, breakpoints: true },
          { tag: '0001_next', when: 2, breakpoints: false },
        ],
      },
      sqlByTag: { '0000_init': 'SELECT 1;', '0001_next': 'SELECT 2;' },
    });

    expect(migrations.map((migration) => migration.folderMillis)).toEqual([
      1, 2,
    ]);
  });

  it('throws when a journal tag has no embedded SQL', () => {
    const build = () =>
      embeddedMigrationsOf({
        journal: {
          entries: [{ tag: '0001_missing', when: 1, breakpoints: true }],
        },
        sqlByTag: {},
      });

    expect(build).toThrow('no embedded SQL for migration 0001_missing');
  });
});
