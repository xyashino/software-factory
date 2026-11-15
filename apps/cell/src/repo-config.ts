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
 * The Cell's config for a run in a repository (PROTOCOL §2, §10). Three layers, each key by key over the
 * one before: `~/.config/factory-cell/config.toml`, then `<repo>/.factory/cell.toml`, then
 * `<repo>/.factory-local/cell.toml`. A repository is `--repo-dir`, or else the one the working directory is
 * in. A layer that is absent is skipped; with no repository only the user's file applies.
 */
export const loadCellConfig = (options: LoadOptions): LoadedConfig => {
  const userPath = configPath(options.env);
  const root =
    options.repoDir !== undefined
      ? resolve(options.repoDir)
      : findRepoRoot(options.cwd ?? process.cwd());
  const repoPath = existingFile(root, REPO_CONFIG_FILE);
  const localPath = existingFile(root, LOCAL_CONFIG_FILE);

  let config = readPartialConfig(userPath);
  if (repoPath !== undefined) {
    config = mergeConfigs(config, readPartialConfig(repoPath));
  }
  if (localPath !== undefined) {
    config = mergeConfigs(config, readPartialConfig(localPath));
  }
  return { config: toCellConfig(config), userPath, repoPath, localPath };
};

/** `<root>/<file>` when the repository root is known and the file exists there; undefined otherwise. */
const existingFile = (
  root: string | undefined,
  file: string,
): string | undefined => {
  if (root === undefined) return undefined;
  const candidate = join(root, file);
  return existsSync(candidate) ? candidate : undefined;
};
