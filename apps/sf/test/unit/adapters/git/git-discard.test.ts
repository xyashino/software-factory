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
import { createGitAdapter } from '../../../../src/adapters/git/git';
import { createProcessAdapter } from '../../../../src/adapters/process/spawn-server';
import type { GitPort } from '../../../../src/application/ports/git.port';

const EMAIL = 'factory-test@example.invalid';
const CELL_FILE = join('.cell', 'build', 'commit.txt');
const MISSING_SHA = 'f'.repeat(40);

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const writeFile = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

describe('git discard', () => {
  let root: string;
  let repo: string;
  let port: GitPort;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'factory-discard-'));
    repo = join(root, 'repo');
    git(root, ['init', '-b', 'main', repo]);
    git(repo, ['config', 'user.name', 'Factory Test']);
    git(repo, ['config', 'user.email', EMAIL]);
    writeFile(join(repo, 'README.md'), 'seed\n');
    git(repo, ['add', '--', '.']);
    git(repo, ['commit', '-m', 'chore: seed']);
    port = createGitAdapter(createProcessAdapter());
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('discard drops edits and untracked files', async () => {
    // Arrange
    writeFile(join(repo, 'README.md'), 'staged\n');
    git(repo, ['add', '--', 'README.md']);
    writeFile(join(repo, 'added.txt'), 'staged new file\n');
    git(repo, ['add', '--', 'added.txt']);
    writeFile(join(repo, 'README.md'), 'edited\n');
    writeFile(join(repo, 'scratch.txt'), 'untracked\n');

    // Act
    await port.discardChanges(repo);

    // Assert
    expect(await port.status(repo)).toBe('');
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('seed\n');
    expect(existsSync(join(repo, 'added.txt'))).toBe(false);
    expect(existsSync(join(repo, 'scratch.txt'))).toBe(false);
  });

  it('discard keeps ignored cell files', async () => {
    // Arrange
    await port.excludeLocally(repo, '.cell/');
    writeFile(join(repo, CELL_FILE), 'build commit\n');
    writeFile(join(repo, 'scratch.txt'), 'untracked\n');

    // Act
    await port.discardChanges(repo);

    // Assert
    expect(existsSync(join(repo, CELL_FILE))).toBe(true);
    expect(existsSync(join(repo, 'scratch.txt'))).toBe(false);
  });

  it('has commit reports missing sha as false', async () => {
    // Arrange
    const head = await port.headSha(repo);

    // Act
    const present = await port.hasCommit(repo, head);
    const missing = await port.hasCommit(repo, MISSING_SHA);

    // Assert
    expect(present).toBe(true);
    expect(missing).toBe(false);
  });

  it('reset hard moves head back', async () => {
    // Arrange
    const base = await port.headSha(repo);
    writeFile(join(repo, 'later.txt'), 'later\n');
    git(repo, ['add', '--', 'later.txt']);
    git(repo, ['commit', '-m', 'chore: later']);

    // Act
    await port.resetHard(repo, base);

    // Assert
    expect(await port.headSha(repo)).toBe(base);
    expect(existsSync(join(repo, 'later.txt'))).toBe(false);
  });
});
