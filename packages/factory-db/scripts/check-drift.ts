/**
 * Fails when `src/schema.ts` and `drizzle/` have drifted apart (STORAGE §9): the snapshot of the
 * current schema differs from the last snapshot in `drizzle/meta`, so `db:generate` would write a
 * new migration. Reads only; nothing is written.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration,
} from 'drizzle-kit/api';
import * as schema from '../src/schema';

const drizzleDir = fileURLToPath(new URL('../drizzle', import.meta.url));

const journal = JSON.parse(
  readFileSync(join(drizzleDir, 'meta', '_journal.json'), 'utf8'),
) as { entries: unknown[] };
const latest = String(journal.entries.length - 1).padStart(4, '0');
const committed = JSON.parse(
  readFileSync(join(drizzleDir, 'meta', `${latest}_snapshot.json`), 'utf8'),
);

const current = await generateSQLiteDrizzleJson(schema);
const drift = await generateSQLiteMigration(committed, current);

if (drift.length > 0) {
  process.stderr.write(
    `schema.ts and drizzle/ drift: ${drift.length} statement(s) not in drizzle/.\n` +
      'Run `pnpm --filter @repo/factory-db db:generate` and commit drizzle/.\n',
  );
  process.exit(1);
}
process.stdout.write('drizzle/ matches src/schema.ts\n');
