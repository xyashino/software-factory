import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  configPath,
  readPartialConfig,
  toCellConfig,
  type CellConfig,
  type PartialConfig,
} from './config';

/** The repository's committed Cell config, relative to its root: `<repo>/.factory/cell.toml`. */
export const REPO_CONFIG_FILE = join('.factory', 'cell.toml');

/**
 * The machine-local Cell config, relative to the repository root: `<repo>/.factory-local/cell.toml`. It is
 * gitignored and overrides the committed `.factory/cell.toml` key by key.
 */
export const LOCAL_CONFIG_FILE = join('.factory-local', 'cell.toml');

/**
 * The repository a Cell runs in: the nearest directory at or above `start` that holds a `.factory/` or a
 * `.git`. Undefined when neither is found up to the filesystem root.
 */
export const findRepoRoot = (start: string): string | undefined => {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.factory')) || existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

/**
 * The repo's config over the user's, key by key: a key the repo file names wins, and every other key
 * keeps the user's value. `projects` is a list, so the repo's list replaces the user's; it is not merged.
 */
export const mergeConfigs = (
  user: PartialConfig,
  repo: PartialConfig,
): PartialConfig => {
  const merged: Record<string, unknown> = { ...user };
  for (const [key, value] of Object.entries(repo)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as PartialConfig;
};

export interface LoadedConfig {
  /** the effective config: defaults, then the user's file, then the repo's */
  config: CellConfig;
  /** the repository root the Cell runs in: `--repo-dir`, or the one the working directory is in */
  repoRoot: string;
  /** the user's config file, which may not exist */
  userPath: string;
  /** the committed repository config applied over the user's, when the repo has one */
  repoPath?: string;
  /** the machine-local repository config applied over the rest, when the repo has one */
  localPath?: string;
}

export interface LoadOptions {
  env: NodeJS.ProcessEnv;
  /** `--repo-dir`: the repository root, used as given (no search) */
  repoDir?: string;
  /** where the repository search starts when `repoDir` is not given (default: the working directory) */
  cwd?: string;
}

/**
 * True when `dir` is a repository root: it holds a `.factory/` or a `.git`. `findRepoRoot` finds the same
 * marks upward; `--repo-dir` is checked against them without a search.
 */
export const isRepoRoot = (dir: string): boolean =>
  existsSync(join(dir, '.factory')) || existsSync(join(dir, '.git'));

/**
 * The Cell's config for a run in a repository. Three layers, each key by key over the
 * one before: `~/.config/factory-cell/config.toml`, then `<repo>/.factory/cell.toml`, then
 * `<repo>/.factory-local/cell.toml`. The repository is `--repo-dir` (which must be a repository root), or
 * else the one the working directory is in. A Cell outside a repository is refused: it has no repository
 * to register a project from and no `.factory-local/` to keep its state in.
 */
export const loadCellConfig = (options: LoadOptions): LoadedConfig => {
  const userPath = configPath(options.env);
  const root =
    options.repoDir !== undefined
      ? resolve(options.repoDir)
      : findRepoRoot(options.cwd ?? process.cwd());
  if (root === undefined) {
    throw new Error(
      'not inside a repository; run factory-cell from a repository or pass --repo-dir <path>',
    );
  }
  if (options.repoDir !== undefined && !isRepoRoot(root)) {
    throw new Error(
      `--repo-dir ${root} is not a repository root (no .factory/ or .git there)`,
    );
  }
  const repoPath = existingFile(root, REPO_CONFIG_FILE);
  const localPath = existingFile(root, LOCAL_CONFIG_FILE);

  let config = readPartialConfig(userPath);
  if (repoPath !== undefined) {
    config = mergeConfigs(config, readPartialConfig(repoPath));
  }
  if (localPath !== undefined) {
    config = mergeConfigs(config, readPartialConfig(localPath));
  }
  return {
    config: toCellConfig(config),
    repoRoot: root,
    userPath,
    repoPath,
    localPath,
  };
};

// `<root>/<file>` when the file exists there; undefined otherwise.
const existingFile = (root: string, file: string): string | undefined => {
  const candidate = join(root, file);
  return existsSync(candidate) ? candidate : undefined;
};
