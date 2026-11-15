import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  configPath,
  readPartialConfig,
  toCellConfig,
  type CellConfig,
  type PartialConfig,
} from './config';

/** The repository's Cell config, relative to its root: `<repo>/.factory/cell.toml`. */
export const REPO_CONFIG_FILE = join('.factory', 'cell.toml');

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
  /** the repository config applied over the user's, when the repo has one */
  repoPath?: string;
}

export interface LoadOptions {
  env: NodeJS.ProcessEnv;
  /** `--repo-dir`: the repository root, used as given (no search) */
  repoDir?: string;
  /** where the repository search starts when `repoDir` is not given (default: the working directory) */
  cwd?: string;
}

/**
 * The Cell's config for a run in a repository (PROTOCOL §2, §10). `<repo>/.factory/cell.toml` overrides
 * `~/.config/factory-cell/config.toml` key by key. A repository is `--repo-dir`, or else the one the
 * working directory is in. With no repository, or none with a `cell.toml`, only the user's file applies.
 */
export const loadCellConfig = (options: LoadOptions): LoadedConfig => {
  const userPath = configPath(options.env);
  const user = readPartialConfig(userPath);
  const root =
    options.repoDir !== undefined
      ? resolve(options.repoDir)
      : findRepoRoot(options.cwd ?? process.cwd());
  const candidate =
    root === undefined ? undefined : join(root, REPO_CONFIG_FILE);
  if (candidate === undefined || !existsSync(candidate)) {
    return { config: toCellConfig(user), userPath };
  }
  const repo = readPartialConfig(candidate);
  return {
    config: toCellConfig(mergeConfigs(user, repo)),
    userPath,
    repoPath: candidate,
  };
};
