import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Runs git in `cwd` with a fixed identity, and returns its trimmed stdout. */
export const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args],
    { cwd, encoding: 'utf8' },
  ).trim();

/** Writes `text` to `name` inside `dir`, making its folders. */
export const writeIn = (dir: string, name: string, text: string): void => {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), text);
};

/**
 * Makes a repo on `main` in `dir` with the given files committed. Returns the commit sha. Used by the
 * Cell tests as the project's repo, so every test works on real git.
 */
export const makeRepo = (
  dir: string,
  files: Record<string, string> = { 'README.md': '# repo\n' },
): string => {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  for (const [name, text] of Object.entries(files)) writeIn(dir, name, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  return git(dir, 'rev-parse', 'HEAD');
};

/** Commits one more file on `main` of `dir`. Returns the new commit sha. */
export const commitFile = (dir: string, name: string, text: string): string => {
  writeIn(dir, name, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', `add ${name}`);
  return git(dir, 'rev-parse', 'HEAD');
};
