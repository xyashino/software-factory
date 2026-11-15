import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitShaSchema, type ProjectId } from '@repo/factory-core/ids';
import { gitMirror } from '../adapters/git-mirror';
import { runProcess } from '../adapters/run';

const PROJECT = 'software-factory' as ProjectId;

let root: string;
let source: string;

/** Commits the given files (path → text) to the source repository, whose base branch is `main`. */
const commitFiles = async (files: Record<string, string>): Promise<string> => {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(source, path, '..'), { recursive: true });
    await writeFile(join(source, path), text);
  }
  await runProcess(['git', 'add', '-A'], { cwd: source });
  await runProcess(
    [
      'git',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'todos',
    ],
    { cwd: source },
  );
  return (
    await runProcess(['git', 'rev-parse', 'HEAD'], { cwd: source })
  ).trim();
};

/** The argv of every process spawned while the spy was installed that has `word` as an argument. */
const spawnedWith = (
  spawn: { mock: { calls: unknown[][] } },
  word: string,
): string[][] =>
  spawn.mock.calls
    .map(([argv]) => argv as string[])
    .filter((argv) => argv.includes(word));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-mirror-'));
  source = join(root, 'source');
  await mkdir(source);
  await runProcess(['git', 'init', '--quiet', '-b', 'main', source]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('git mirror todo files', () => {
  it('reads every todo file of a commit in one git process, with multibyte text intact', async () => {
    const sha = await commitFiles({
      'todos/add-login.md': '# Ünïcode ✓ 日本語\n\nBody with “quotes”.\n',
      'todos/plain.md': '# Plain\n\nBody.\n',
      'todos/notes.txt': 'not a todo\n',
      'README.md': '# Repo\n',
    });
    const mirror = gitMirror({ mirrorsDir: join(root, 'mirrors') });
    const commit = await mirror.sync({
      projectId: PROJECT,
      repoUrl: source,
      baseBranch: 'main',
    });
    const spawn = vi.spyOn(Bun, 'spawn');

    const files = await mirror.todoFiles(PROJECT, commitShaSchema.parse(sha));

    expect(commit).toBe(sha);
    expect(files).toEqual([
      {
        file: 'todos/add-login.md',
        text: '# Ünïcode ✓ 日本語\n\nBody with “quotes”.\n',
      },
      { file: 'todos/plain.md', text: '# Plain\n\nBody.\n' },
    ]);
    const catFiles = spawnedWith(spawn, 'cat-file');
    expect(catFiles).toHaveLength(1);
    expect(catFiles[0]).toContain('--batch');
  });

  it('returns no todos and starts no cat-file process when the todos folder is empty', async () => {
    const sha = await commitFiles({ 'README.md': '# Repo\n' });
    const mirror = gitMirror({ mirrorsDir: join(root, 'mirrors') });
    await mirror.sync({
      projectId: PROJECT,
      repoUrl: source,
      baseBranch: 'main',
    });
    const spawn = vi.spyOn(Bun, 'spawn');

    const files = await mirror.todoFiles(PROJECT, commitShaSchema.parse(sha));

    expect(files).toEqual([]);
    expect(spawnedWith(spawn, 'cat-file')).toEqual([]);
  });
});
