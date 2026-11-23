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
import { createProcessAdapter } from '../../src/adapters/process/spawn-server';
import type { GitPort } from '../../src/application/ports/git.port';

const SLUG = 'cli-11';
const BRANCH = `factory/${SLUG}`;
const UNKNOWN_SHA = '0123456789abcdef0123456789abcdef01234567';
const EMAIL = 'factory-test@example.invalid';

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

const writeFile = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const readFile = (path: string): string => readFileSync(path, 'utf8');

interface Sandbox {
  root: string;
  repo: string;
  worktree: string;
  port: GitPort;
  base: string;
}

let sandbox: Sandbox;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'factory-resume-'));
  const repo = join(root, 'repo');
  git(root, ['init', '-b', 'main', repo]);
  git(repo, ['config', 'user.name', 'Factory Test']);
  git(repo, ['config', 'user.email', EMAIL]);
  writeFile(join(repo, 'README.md'), 'seed\n');
  git(repo, ['add', '--', '.']);
  git(repo, ['commit', '-m', 'chore: seed']);
  const port = createGitAdapter(createProcessAdapter());
  const worktree = join(repo, '.worktrees', SLUG);
  sandbox = {
    root,
    repo,
    worktree,
    port,
    base: git(repo, ['rev-parse', 'HEAD']).trim(),
  };
});

afterEach(() => {
  rmSync(sandbox.root, { recursive: true, force: true });
});

const startWorktree = async (): Promise<void> => {
  const { port, repo, worktree } = sandbox;
  await port.worktreeAdd(repo, worktree, BRANCH, 'main');
  await port.excludeLocally(worktree, '.cell/');
  writeFile(join(worktree, '.cell', 'worktree.json'), '{}\n');
};

const commitBuild = async (text: string): Promise<string> => {
  const { port, worktree } = sandbox;
  writeFile(join(worktree, 'README.md'), text);
  await port.commit(worktree, ['README.md'], 'feat: build');
  return port.headSha(worktree);
};

describe('cell worktree resume', () => {
  it('killed during first build resets to base and drops the dirty files', async () => {
    // Arrange
    await startWorktree();
    const { port, worktree, base } = sandbox;
    writeFile(join(worktree, 'README.md'), 'half edit\n');
    writeFile(join(worktree, 'scratch.txt'), 'stray\n');

    // Act
    await port.resetHard(worktree, base);
    await port.clean(worktree);

    // Assert
    expect(await port.headSha(worktree)).toBe(base);
    expect(readFile(join(worktree, 'README.md'))).toBe('seed\n');
    expect(existsSync(join(worktree, 'scratch.txt'))).toBe(false);
  });

  it('killed during retry build resets to the previous build commit', async () => {
    // Arrange
    await startWorktree();
    const { port, worktree, base } = sandbox;
    const build = await commitBuild('built once\n');
    writeFile(join(worktree, 'README.md'), 'half edit\n');

    // Act
    await port.resetHard(worktree, build);
    await port.clean(worktree);

    // Assert
    expect(build).not.toBe(base);
    expect(await port.headSha(worktree)).toBe(build);
    expect(readFile(join(worktree, 'README.md'))).toBe('built once\n');
  });

  it('a reset keeps the ignored step files of earlier stations', async () => {
    // Arrange
    await startWorktree();
    const { port, worktree, base } = sandbox;
    writeFile(join(worktree, '.cell', 'build', 'state.json'), '{}\n');

    // Act
    await port.resetHard(worktree, base);
    await port.clean(worktree);

    // Assert
    expect(readFile(join(worktree, '.cell', 'build', 'state.json'))).toBe(
      '{}\n',
    );
  });

  it('an unknown head commit is not in the clone', async () => {
    // Arrange
    const { port, repo, base } = sandbox;

    // Act
    const known = await port.hasCommit(repo, base);
    const unknown = await port.hasCommit(repo, UNKNOWN_SHA);

    // Assert
    expect(known).toBe(true);
    expect(unknown).toBe(false);
  });

  it('a discarded worktree lets a fresh start recreate its branch', async () => {
    // Arrange
    await startWorktree();
    const { port, repo, worktree } = sandbox;

    // Act
    await port.worktreeRemove(repo, worktree);
    await port.deleteBranch(repo, BRANCH);
    await port.worktreeAdd(repo, worktree, BRANCH, 'main');

    // Assert
    expect(existsSync(join(worktree, 'README.md'))).toBe(true);
    expect(git(repo, ['branch', '--list', BRANCH]).trim()).toContain(BRANCH);
  });

  it('discards a worktree directory git no longer tracks', async () => {
    // Arrange
    const { port, repo, worktree } = sandbox;
    writeFile(join(worktree, '.cell', 'worktree.json'), '{}\n');

    // Act
    await port.worktreeRemove(repo, worktree);

    // Assert
    expect(existsSync(worktree)).toBe(false);
    expect(git(repo, ['worktree', 'list']).includes(worktree)).toBe(false);
  });

  it('deleting a branch that is absent is a no-op', async () => {
    // Arrange
    const { port, repo } = sandbox;

    // Act
    const attempt = port.deleteBranch(repo, 'factory/never-existed');

    // Assert
    await expect(attempt).resolves.toBeUndefined();
  });
});
