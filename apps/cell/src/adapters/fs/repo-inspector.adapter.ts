import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  RepoInspectorPort,
  RepoProfile,
} from '../../application/ports/repo-inspector.port';

const LINE_FILE = /\.ya?ml$/;

const projectIdOf = (configPath: string): string | null => {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      project?: unknown;
    };
    return typeof config.project === 'string' && config.project.length > 0
      ? config.project
      : null;
  } catch {
    return null;
  }
};

const linesOf = (linesDir: string): string[] =>
  existsSync(linesDir)
    ? readdirSync(linesDir)
        .filter((file) => LINE_FILE.test(file))
        .map((file) => file.replace(LINE_FILE, ''))
        .sort()
    : [];

export const createRepoInspector = (): RepoInspectorPort => ({
  inspect: (repoRoot): RepoProfile | null => {
    const projectId = projectIdOf(join(repoRoot, '.factory', 'config.json'));
    const lines = linesOf(join(repoRoot, '.factory', 'lines'));
    if (projectId === null || lines.length === 0) return null;
    return { projectId, lines };
  },
});
