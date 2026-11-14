import { join } from 'node:path';
import { MIGRATIONS_DIR, migrate } from '@repo/factory-db/migrate';
import { openDatabase } from '@repo/factory-db/sqlite-event-store';
import { DATABASE_FILE_NAME } from './open-runtime';

/**
 * Creates a data directory's schema and one `projects` row, before a runtime opens it. Project
 * registration is the Factory's job (intake, v2-10); until then, tests and local fixtures use this to
 * stand in for it. The runtime itself never inserts a project.
 */
export const seedProject = (
  dataDir: string,
  project: {
    projectId: string;
    repoUrl: string;
    baseBranch?: string;
    maxRunning?: number;
  },
): void => {
  const db = openDatabase(join(dataDir, DATABASE_FILE_NAME));
  try {
    migrate(db, MIGRATIONS_DIR);
    db.run(
      `INSERT INTO projects (project_id, repo_url, base_branch, max_running, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        project.projectId,
        project.repoUrl,
        project.baseBranch ?? 'main',
        project.maxRunning ?? 2,
        0,
      ],
    );
  } finally {
    db.close();
  }
};
