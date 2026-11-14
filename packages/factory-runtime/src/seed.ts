import { join } from 'node:path';
import { MIGRATIONS_DIR, migrate } from '@repo/factory-db/migrate';
import { openDatabase } from '@repo/factory-db/sqlite-event-store';
import { DATABASE_FILE_NAME } from './open-runtime';

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
