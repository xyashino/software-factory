import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, writeIn } from './git-repo';

/** The `.factory/` directory of this checkout: the definitions a fixture repo renders its jobs from. */
export const SHIPPED_FACTORY = fileURLToPath(
  new URL('../../../../.factory', import.meta.url),
);

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

/**
 * A `.factory/` tree as repo files, keyed by their repo-relative path. A fixture repo that gets these files renders its
 * Operator prompts and PR bodies from them, as a real repo does (PROTOCOL §4). Defaults to this checkout's own.
 */
export const factoryFiles = (
  dir: string = SHIPPED_FACTORY,
): Record<string, string> =>
  Object.fromEntries(
    filesUnder(dir).map((path) => [
      join('.factory', relative(dir, path)),
      readFileSync(path, 'utf8'),
    ]),
  );

/** Commits the shipped `.factory/` onto the checkout at `repo` (a git repo on `main`), as a repo's own commit. */
export const commitFactoryTo = (repo: string): void => {
  for (const [path, text] of Object.entries(factoryFiles())) {
    writeIn(repo, path, text);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'add the repo definitions');
};
