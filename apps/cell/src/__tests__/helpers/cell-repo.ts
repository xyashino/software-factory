import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { must } from './git';

/** The origin url a fixture repository names: a Cell registers its project from it (PROTOCOL §10). */
export const FIXTURE_ORIGIN = 'https://example.test/cell-fixture.git';

/**
 * A repository a Cell runs in (`--repo-dir`): a git repository whose `origin` is the project's repo, created
 * once. The Cell fetches that origin for its worktrees, so a test that runs jobs names the real remote. The
 * Cell keeps its state in `<dir>/.factory-local/cell` unless a test names another data directory.
 */
export const cellRepo = async (
  dir: string,
  origin: string = FIXTURE_ORIGIN,
): Promise<string> => {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, '.git'))) {
    await must(dir, ['init', '--quiet', '-b', 'main']);
    await must(dir, ['remote', 'add', 'origin', origin]);
  }
  return dir;
};
