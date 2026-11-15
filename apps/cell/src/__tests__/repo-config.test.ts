import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectIdSchema } from '@repo/factory-core/ids';
import { DEFAULT_SLOTS } from '../config';
import {
  findRepoRoot,
  loadCellConfig,
  mergeConfigs,
  REPO_CONFIG_FILE,
} from '../repo-config';

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'factory-cell-repo-config-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A repository root: a directory with `.factory/` (and optionally its cell.toml). */
const repoWith = (name: string, cellToml?: string): string => {
  const root = join(base, name);
  mkdirSync(join(root, '.factory'), { recursive: true });
  if (cellToml !== undefined) {
    writeFileSync(join(root, REPO_CONFIG_FILE), cellToml);
  }
  return root;
};

/** A user config directory with its `factory-cell/config.toml`, read through XDG_CONFIG_HOME. */
const userEnv = (toml?: string): NodeJS.ProcessEnv => {
  const xdg = join(base, 'xdg');
  mkdirSync(join(xdg, 'factory-cell'), { recursive: true });
  if (toml !== undefined) {
    writeFileSync(join(xdg, 'factory-cell', 'config.toml'), toml);
  }
  return { XDG_CONFIG_HOME: xdg };
};

describe('findRepoRoot', () => {
  it('finds the repository from a directory nested inside it', () => {
    const root = repoWith('app');
    const nested = join(root, 'src', 'deep');
    mkdirSync(nested, { recursive: true });

    expect(findRepoRoot(nested)).toBe(root);
  });

  it('stops at a .git boundary even without a .factory/', () => {
    const repo = join(base, 'plain');
    mkdirSync(join(repo, '.git'), { recursive: true });
    const nested = join(repo, 'pkg');
    mkdirSync(nested);

    expect(findRepoRoot(nested)).toBe(repo);
  });

  it('answers undefined when no repository is above the directory', () => {
    const lone = join(base, 'lone');
    mkdirSync(lone);

    expect(findRepoRoot(lone)).toBeUndefined();
  });
});

describe('mergeConfigs', () => {
  it('lets the repo win key by key and keeps the user value for the rest', () => {
    const merged = mergeConfigs(
      { slots: 3, runners: ['claude'], worktree_limit: 4 },
      { slots: 1 },
    );

    expect(merged).toEqual({
      slots: 1,
      runners: ['claude'],
      worktree_limit: 4,
    });
  });

  it('replaces the projects list rather than merging it', () => {
    const merged = mergeConfigs(
      {
        projects: [
          projectIdSchema.parse('alpha'),
          projectIdSchema.parse('beta'),
        ],
      },
      { projects: [projectIdSchema.parse('gamma')] },
    );

    expect(merged.projects).toEqual(['gamma']);
  });
});

describe('loadCellConfig', () => {
  it('reads only the user file when the working directory has no repository', () => {
    const lone = join(base, 'lone');
    mkdirSync(lone);
    const loaded = loadCellConfig({
      env: userEnv('slots = 5\n'),
      cwd: lone,
    });

    expect(loaded.config.slots).toBe(5);
    expect(loaded.repoPath).toBeUndefined();
  });

  it('applies the repo cell.toml over the user file when run inside the repo', () => {
    const root = repoWith('app', 'slots = 1\nprojects = ["app"]\n');
    const loaded = loadCellConfig({
      env: userEnv('slots = 5\nrunners = ["claude"]\n'),
      cwd: root,
    });

    expect(loaded.config).toMatchObject({
      slots: 1,
      projects: ['app'],
      runners: ['claude'],
    });
    expect(loaded.repoPath).toBe(join(root, REPO_CONFIG_FILE));
  });

  it('uses --repo-dir as the repository, whatever the working directory', () => {
    const root = repoWith('elsewhere', 'worktree_limit = 3\n');
    const outside = join(base, 'outside');
    mkdirSync(outside);
    const loaded = loadCellConfig({
      env: userEnv(),
      repoDir: root,
      cwd: outside,
    });

    expect(loaded.config.worktreeLimit).toBe(3);
    expect(loaded.repoPath).toBe(join(root, REPO_CONFIG_FILE));
  });

  it('falls back to the defaults when neither file exists', () => {
    const root = repoWith('bare');
    const loaded = loadCellConfig({ env: userEnv(), cwd: root });

    expect(loaded.config.slots).toBe(DEFAULT_SLOTS);
    expect(loaded.repoPath).toBeUndefined();
  });

  it('refuses an unknown key in the repo file and names that file', () => {
    const root = repoWith('typo', 'slotz = 2\n');

    expect(() => loadCellConfig({ env: userEnv(), cwd: root })).toThrow(
      /cell\.toml.*slotz/,
    );
  });
});
