import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import { MIGRATIONS_DIR, migrate } from '@repo/factory-db/migrate';
import { openDatabase } from '@repo/factory-db/sqlite-event-store';
import { loadDefinitions } from '@repo/factory-definitions/load';
import { DATABASE_FILE_NAME } from './open-runtime';

/** This repository's own `.factory/`: the shipped Lines a test pins into its Work orders. */
const SHIPPED_FACTORY_ROOT = fileURLToPath(
  new URL('../../../.factory', import.meta.url),
);

/**
 * Creates a data directory's schema and one `projects` row, before a runtime opens it. A test or a
 * local fixture helper, not the product path: real projects are registered with `factory project add`
 * (PROTOCOL §3.1), which needs no SQLite access. The runtime itself never inserts a project.
 */
export const seedProject = (
  dataDir: string,
  project: {
    projectId: string;
    repoUrl: string;
    baseBranch?: string;
    maxRunning?: number;
    depPolicy?: 'delivered' | 'merged';
  },
): void => {
  const db = openDatabase(join(dataDir, DATABASE_FILE_NAME));
  try {
    migrate(db, MIGRATIONS_DIR);
    db.run(
      `INSERT INTO projects (project_id, repo_url, base_branch, max_running, dep_policy, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        project.projectId,
        project.repoUrl,
        project.baseBranch ?? 'main',
        project.maxRunning ?? 2,
        project.depPolicy ?? 'delivered',
        0,
      ],
    );
  } finally {
    db.close();
  }
};

/**
 * A Line the repository ships (`.factory/lines/<name>.yml`), loaded and pinned: its snapshot, the one a
 * test puts in a Work order's `line`. Test helper only: the server never reads a repository's definitions.
 */
export const shippedLine = (name: string): LineSnapshot => {
  const result = loadDefinitions(SHIPPED_FACTORY_ROOT);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const loaded = result.value.lines.get(name);
  if (!loaded) throw new Error(`the shipped line ${name} did not load`);
  return loaded.snapshot;
};

/**
 * A test Line, written as YAML, loaded and pinned: returns its snapshot, the one a test puts in a Work
 * order's `line`. The Line sits in a copy of `factoryRoot` (a `.factory/` layout) under `dataDir`, so
 * the shipped definitions stay untouched. Test helper only: the server never loads a Line itself.
 */
export const fixtureLine = (
  dataDir: string,
  factoryRoot: string,
  name: string,
  yaml: string,
): LineSnapshot => {
  const root = join(dataDir, 'definitions');
  rmSync(root, { recursive: true, force: true });
  cpSync(factoryRoot, root, {
    recursive: true,
    filter: (source) => !source.includes('node_modules'),
  });
  rmSync(join(root, 'lines'), { recursive: true, force: true });
  mkdirSync(join(root, 'lines'), { recursive: true });
  writeFileSync(join(root, 'lines', `${name}.yml`), yaml);
  const result = loadDefinitions(root);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const loaded = result.value.lines.get(name);
  if (!loaded) throw new Error(`the fixture line ${name} did not load`);
  return loaded.snapshot;
};
