import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectIdSchema } from '@repo/factory-core/ids';
import {
  findRepoRoot,
  LOCAL_CONFIG_FILE,
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
      { worktree_limit: 12, runners: ['claude'] },
      { worktree_limit: 4 },
    );

    expect(merged).toEqual({
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
  it('refuses to start outside a repository and names --repo-dir', () => {
    const lone = join(base, 'lone');
    mkdirSync(lone);

    expect(() => loadCellConfig({ env: userEnv(), cwd: lone })).toThrow(
      /not inside a repository.*--repo-dir/,
    );
  });

  it('refuses --repo-dir that is not a repository root', () => {
    const plain = join(base, 'plain');
    mkdirSync(plain);

    expect(() =>
      loadCellConfig({ env: userEnv(), repoDir: plain, cwd: base }),
    ).toThrow(/--repo-dir .* is not a repository root/);
  });

  it('answers the repository root it runs in', () => {
    const root = repoWith('rooted');
    const nested = join(root, 'src');
    mkdirSync(nested);

    expect(loadCellConfig({ env: userEnv(), cwd: nested }).repoRoot).toBe(root);
  });

  it('applies the repo cell.toml over the user file when run inside the repo', () => {
    const root = repoWith('app', 'worktree_limit = 2\nprojects = ["app"]\n');
    const loaded = loadCellConfig({
      env: userEnv('worktree_limit = 5\nrunners = ["claude"]\n'),
      cwd: root,
    });

    expect(loaded.config).toMatchObject({
      worktreeLimit: 2,
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
    expect(loaded.repoRoot).toBe(root);
    expect(loaded.repoPath).toBe(join(root, REPO_CONFIG_FILE));
  });

  it('falls back to the defaults when neither file exists', () => {
    const root = repoWith('bare');
    const loaded = loadCellConfig({ env: userEnv(), cwd: root });

    expect(loaded.config.worktreeLimit).toBe(8);
    expect(loaded.repoPath).toBeUndefined();
  });

  it('layers the local cell.toml over the repo file over the user file, key by key', () => {
    const root = repoWith(
      'layered',
      'worktree_limit = 2\nrunners = ["repo"]\n',
    );
    mkdirSync(join(root, '.factory-local'), { recursive: true });
    writeFileSync(
      join(root, LOCAL_CONFIG_FILE),
      'worktree_limit = 9\nfactory_url = "http://local"\n',
    );
    const loaded = loadCellConfig({
      env: userEnv('worktree_limit = 5\ncell_data_dir = "/user"\n'),
      cwd: root,
    });

    expect(loaded.config).toMatchObject({
      worktreeLimit: 9,
      runners: ['repo'],
      factoryUrl: 'http://local',
      cellDataDir: '/user',
    });
    expect(loaded.repoPath).toBe(join(root, REPO_CONFIG_FILE));
    expect(loaded.localPath).toBe(join(root, LOCAL_CONFIG_FILE));
  });

  it('applies a local cell.toml alone, over the user file, when the repo has no committed one', () => {
    const root = repoWith('local-only');
    mkdirSync(join(root, '.factory-local'), { recursive: true });
    writeFileSync(join(root, LOCAL_CONFIG_FILE), 'cell_data_dir = "/local"\n');
    const loaded = loadCellConfig({
      env: userEnv('worktree_limit = 5\n'),
      cwd: root,
    });

    expect(loaded.config).toMatchObject({
      cellDataDir: '/local',
      worktreeLimit: 5,
    });
    expect(loaded.repoPath).toBeUndefined();
    expect(loaded.localPath).toBe(join(root, LOCAL_CONFIG_FILE));
  });

  it('leaves localPath unset when the repo has no local cell.toml', () => {
    const root = repoWith('no-local', 'worktree_limit = 4\n');
    const loaded = loadCellConfig({ env: userEnv(), cwd: root });

    expect(loaded.config.worktreeLimit).toBe(4);
    expect(loaded.localPath).toBeUndefined();
  });

  it('refuses an unknown key in the repo file and names that file', () => {
    const root = repoWith('typo', 'slotz = 2\n');

    expect(() => loadCellConfig({ env: userEnv(), cwd: root })).toThrow(
      /cell\.toml.*slotz/,
    );
  });
});
