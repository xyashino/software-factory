import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { must } from './git';

/** The origin url a fixture repository names: a Cell registers its project from it (PROTOCOL §10). */
export const FIXTURE_ORIGIN = 'https://example.test/cell-fixture.git';

/**
 * A repository a Cell runs in (`--repo-dir`): a git repository with an origin, created once. The Cell
 * keeps its state in `<dir>/.factory-local/cell` unless a test names another data directory.
 */
export const cellRepo = async (dir: string): Promise<string> => {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, '.git'))) {
    await must(dir, ['init', '--quiet', '-b', 'main']);
    await must(dir, ['remote', 'add', 'origin', FIXTURE_ORIGIN]);
  }
  return dir;
};
