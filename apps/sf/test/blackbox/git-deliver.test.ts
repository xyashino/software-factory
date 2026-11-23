import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitAdapter } from '../../src/adapters/git/git';
import { createProcessAdapter } from '../../src/adapters/process/spawn';
import type { Ports } from '../../src/application/core/procedure';
import type { PrPort, PrSpec } from '../../src/application/ports/pr.port';
import { checkpointStation } from '../../src/application/procedures/cell/checkpoint.procedure';
import { deliverWorkOrder } from '../../src/application/procedures/cell/deliver.procedure';
import { createFakePorts } from '../support/fake-ports';

const SLUG = 'cli-10';
const BRANCH = `factory/${SLUG}`;
const COMMIT_TEXT =
  'feat(factory): add git work for a job\n\n- adds worktree\n';
const PR_TEMPLATE = '.factory/templates/pr/body.md';
const EMAIL = 'factory-test@example.invalid';

interface Sandbox {
  root: string;
  remote: string;
  repo: string;
  worktree: string;
}

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

const writeFile = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const createSandbox = (): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), 'factory-git-'));
  const remote = join(root, 'remote.git');
  const repo = join(root, 'repo');
  git(root, ['init', '--bare', '-b', 'main', remote]);
  git(root, ['init', '-b', 'main', repo]);
  git(repo, ['config', 'user.name', 'Factory Test']);
  git(repo, ['config', 'user.email', EMAIL]);
  git(repo, ['remote', 'add', 'origin', remote]);
  writeFile(join(repo, 'README.md'), 'seed\n');
  writeFile(
    join(repo, PR_TEMPLATE),
    '# {{objective}}\n\n{{changes}}\n\n{{adrSection}}\n\n{{verificationSection}}\n',
  );
  git(repo, ['add', '--', '.']);
  git(repo, ['commit', '-m', 'chore: seed']);
  git(repo, ['push', '-u', 'origin', 'main']);
  return { root, remote, repo, worktree: join(repo, '.worktrees', SLUG) };
};

const portsFor = (published: PrSpec[]): Ports => {
  const processPort = createProcessAdapter();
  const pr: PrPort = {
    publish: async (spec) => {
      published.push(spec);
    },
  };
  const { ports } = createFakePorts();
  return {
    ...ports,
    fs: {
      ...ports.fs,
      readText: async (path) => readFileSync(path, 'utf8'),
      exists: async (path) => existsSync(path),
      writeText: async (path, text) => writeFile(path, text),
    },
    git: createGitAdapter(processPort),
    pr,
  };
};

describe('git work for a job', () => {
  let sandbox: Sandbox;
  let published: PrSpec[];
  let ports: Ports;

  afterEach(() => {
    rmSync(sandbox.root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    sandbox = createSandbox();
    published = [];
    ports = portsFor(published);
    await ports.git.worktreeAdd(sandbox.repo, sandbox.worktree, BRANCH, 'main');
    await ports.git.excludeLocally(sandbox.worktree, '.cell/');
    writeFile(
      join(sandbox.worktree, '.cell', 'build', 'commit.txt'),
      COMMIT_TEXT,
    );
    writeFile(
      join(sandbox.worktree, '.cell', 'build', 'report.md'),
      'report\n',
    );
    writeFile(
      join(sandbox.worktree, 'src', 'feature.ts'),
      'export const x = 1;\n',
    );
    writeFile(join(sandbox.worktree, 'notes.ts'), 'not reported\n');
  });

  it('keeps the cell directory out of git status', async () => {
    // Arrange & Act
    const status = await ports.git.status(sandbox.worktree);

    // Assert
    expect(status).toContain('src/');
    expect(status).not.toContain('.cell');
  });

  it('commits only the paths the station reported', async () => {
    // Arrange
    const producedFiles = ['src/feature.ts', '.cell/build/report.md'];

    // Act
    const { commitSha } = await checkpointStation(ports, {
      worktree: sandbox.worktree,
      slug: SLUG,
      stepId: 'build',
      producedFiles,
      commits: true,
    });

    // Assert
    const changed = git(sandbox.worktree, [
      'show',
      '--name-only',
      '--format=',
      'HEAD',
    ]);
    expect(changed.trim()).toBe('src/feature.ts');
    expect(commitSha).toBe(git(sandbox.worktree, ['rev-parse', 'HEAD']).trim());
    expect(await ports.git.status(sandbox.worktree)).toContain('notes.ts');
  });

  it('committing station pushes its commit to the branch', async () => {
    // Arrange
    const producedFiles = ['src/feature.ts'];

    // Act
    await checkpointStation(ports, {
      worktree: sandbox.worktree,
      slug: SLUG,
      stepId: 'build',
      producedFiles,
      commits: true,
    });

    // Assert
    expect(git(sandbox.repo, ['ls-remote', sandbox.remote, BRANCH])).toContain(
      BRANCH,
    );
  });

  it('retry commits on top of the previous build commit', async () => {
    // Arrange
    const first = await checkpointStation(ports, {
      worktree: sandbox.worktree,
      slug: SLUG,
      stepId: 'build',
      producedFiles: ['src/feature.ts'],
      commits: true,
    });
    writeFile(
      join(sandbox.worktree, 'src', 'feature.ts'),
      'export const x = 2;\n',
    );

    // Act
    const second = await checkpointStation(ports, {
      worktree: sandbox.worktree,
      slug: SLUG,
      stepId: 'build',
      producedFiles: ['src/feature.ts'],
      commits: true,
    });

    // Assert
    expect(second.commitSha).not.toBe(first.commitSha);
    expect(git(sandbox.worktree, ['rev-parse', 'HEAD^']).trim()).toBe(
      first.commitSha,
    );
  });

  it('non-committing station leaves no commit and no push', async () => {
    // Arrange
    const base = git(sandbox.worktree, ['rev-parse', 'HEAD']).trim();

    // Act
    const result = await checkpointStation(ports, {
      worktree: sandbox.worktree,
      slug: SLUG,
      stepId: 'plan',
      producedFiles: [],
      commits: false,
    });

    // Assert
    expect(result.commitSha).toBe(base);
    expect(git(sandbox.worktree, ['rev-parse', 'HEAD']).trim()).toBe(base);
    expect(
      git(sandbox.repo, ['ls-remote', sandbox.remote, BRANCH]),
    ).not.toContain(BRANCH);
  });

  it('non-committing dirty station is discarded and reports head', async () => {
    // Arrange
    const base = git(sandbox.worktree, ['rev-parse', 'HEAD']).trim();
    writeFile(join(sandbox.worktree, 'README.md'), 'edited\n');

    // Act
    const result = await checkpointStation(ports, {
      worktree: sandbox.worktree,
      slug: SLUG,
      stepId: 'quality-gate',
      producedFiles: [],
      commits: false,
    });

    // Assert
    expect(result.commitSha).toBe(base);
    expect(result.discarded).toEqual(
      expect.arrayContaining(['README.md', 'src/', 'notes.ts']),
    );
    expect(await ports.git.status(sandbox.worktree)).toBe('');
    expect(
      existsSync(join(sandbox.worktree, '.cell', 'build', 'commit.txt')),
    ).toBe(true);
  });

  it('delivers the branch, publishes the PR and removes the worktree', async () => {
    // Arrange
    await checkpointStation(ports, {
      worktree: sandbox.worktree,
      slug: SLUG,
      stepId: 'build',
      producedFiles: ['src/feature.ts'],
      commits: true,
    });
    writeFile(
      join(sandbox.worktree, 'decisions', 'entry.md'),
      '---\nsummary: Did it\nwhy: Needed\n---\n\n- bullet\n',
    );

    // Act
    await deliverWorkOrder(ports, {
      repoRoot: sandbox.repo,
      worktree: sandbox.worktree,
      slug: SLUG,
      baseBranch: 'main',
      priorStepIds: ['build'],
      taskDescription: '## Objective\n\nAdd git work.\n',
      adrPaths: ['decisions/entry.md'],
      checks: ['bun run ci:verify'],
    });

    // Assert
    expect(git(sandbox.repo, ['ls-remote', sandbox.remote, BRANCH])).toContain(
      BRANCH,
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.title).toBe('feat(factory): add git work for a job');
    expect(published[0]?.body).toContain('# Add git work.');
    expect(published[0]?.body).toContain('> **Why:** Needed');
    expect(published[0]?.body).toContain('- [x] `bun run ci:verify`');
    expect(published[0]?.body).not.toContain('Event log:');
    expect(existsSync(sandbox.worktree)).toBe(false);
  });

  it('keeps the worktree when the push fails', async () => {
    // Arrange
    git(sandbox.repo, [
      'remote',
      'set-url',
      'origin',
      join(sandbox.repo, '..', 'missing.git'),
    ]);

    // Act
    const delivery = deliverWorkOrder(ports, {
      repoRoot: sandbox.repo,
      worktree: sandbox.worktree,
      slug: SLUG,
      baseBranch: 'main',
      priorStepIds: ['build'],
    });

    // Assert
    await expect(delivery).rejects.toThrow('git push failed');
    expect(existsSync(sandbox.worktree)).toBe(true);
    expect(published).toHaveLength(0);
  });
});
