import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import {
  ensureMirror,
  excludeCellDir,
  mirrorPathOf,
} from '../workspace/mirror';
import { prepareWorkspace, type PrepareContext } from '../workspace/prepare';
import { shellQuote } from '../workspace/shell';
import { worktreePathOf } from '../workspace/worktree';
import { git, makeRepo, commitFile } from '../testing/git-repo';

let root: string;
let origin: string;
let cellDataDir: string;
let counter: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-workspace-'));
  origin = join(root, 'origin');
  cellDataDir = join(root, 'cell');
  counter = join(root, 'setup-count.txt');
  makeRepo(origin);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The prepare context a job runs with: real system, logs in the Cell's directory. */
const contextWith = (
  overrides: Partial<PrepareContext> = {},
): PrepareContext => ({
  shell: {
    system: createSystemAdapter(),
    logDir: join(cellDataDir, 'logs', 'test'),
  },
  cellDataDir,
  worktreeLimit: 8,
  inUse: new Set(),
  ...overrides,
});

/** A job with only the fields the workspace reads. */
const jobWith = (dir: string, setup: string[] = [], sync: string[] = []): Job =>
  ({
    jobId: '01J0000000000000000000000J',
    repo: { url: origin, baseBranch: 'main', branch: `factory/${dir}` },
    base: { branchBase: 'main' },
    workspace: { dir, sync, setup, timeoutMs: 60_000 },
  }) as unknown as Job;

/** The command that appends one line to the counter file: how many times setup ran. */
const countSetup = (): string => `echo run >> ${shellQuote(counter)}`;
const setupRuns = (): number =>
  existsSync(counter)
    ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length
    : 0;

describe('workspace mirror', () => {
  it('clones the repo on first use and fetches its new commits on the next', async () => {
    const shell = contextWith().shell;
    await ensureMirror(shell, { cellDataDir, url: origin });
    const next = commitFile(origin, 'later.txt', 'later\n');

    const second = await ensureMirror(shell, { cellDataDir, url: origin });

    expect(second.ok).toBe(true);
    const mirror = mirrorPathOf(cellDataDir, origin);
    expect(git(mirror, 'rev-parse', 'refs/heads/main')).toBe(next);
  });

  it('keeps .cell/ out of the worktrees once, however often it is run', async () => {
    const shell = contextWith().shell;
    await ensureMirror(shell, { cellDataDir, url: origin });
    await ensureMirror(shell, { cellDataDir, url: origin });

    const exclude = readFileSync(
      join(mirrorPathOf(cellDataDir, origin), 'info', 'exclude'),
      'utf8',
    );

    expect(
      exclude.split('\n').filter((line) => line === '.cell/'),
    ).toHaveLength(1);
  });

  it('adds the exclude line to an existing file without losing its lines', () => {
    const mirror = join(root, 'mirror.git');
    mkdirForExclude(mirror, 'custom-line\n');

    excludeCellDir(mirror);

    const exclude = readFileSync(join(mirror, 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('custom-line');
    expect(exclude).toContain('.cell/');
  });
});

describe('workspace prepare', () => {
  it('puts the worktree at the branch base and reports its HEAD', async () => {
    const head = git(origin, 'rev-parse', 'HEAD');

    const prepared = await prepareWorkspace(contextWith(), jobWith('todo-1'));

    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.head).toBe(head);
    expect(git(prepared.worktree, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('runs setup once per commit and skips it on the next prepare of that commit', async () => {
    const job = jobWith('todo-2', [countSetup()]);

    await prepareWorkspace(contextWith(), job);
    await prepareWorkspace(contextWith(), job);

    expect(setupRuns()).toBe(1);
  });

  it('runs setup again when a new commit is prepared', async () => {
    const job = jobWith('todo-3', [countSetup()]);
    await prepareWorkspace(contextWith(), job);
    commitFile(origin, 'next.txt', 'next\n');

    await prepareWorkspace(contextWith(), job);

    expect(setupRuns()).toBe(2);
  });

  it('reports a failed setup with its stage and the commands it ran', async () => {
    const prepared = await prepareWorkspace(
      contextWith(),
      jobWith('todo-4', ['echo building', 'exit 3']),
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.stage).toBe('setup');
    expect(prepared.detail).toContain('exited 3');
    const log = new TextDecoder().decode(prepared.log);
    expect(log).toContain('$ exit 3');
    expect(log).toContain('building');
  });

  it('reports a repo that cannot be fetched as a fetch failure', async () => {
    const job = {
      ...jobWith('todo-5'),
      repo: {
        url: join(root, 'missing.git'),
        baseBranch: 'main',
        branch: 'factory/x',
      },
    } as Job;

    const prepared = await prepareWorkspace(contextWith(), job);

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.stage).toBe('fetch');
  });

  it('reports a pinned base the mirror does not have as a worktree failure', async () => {
    const job = {
      ...jobWith('todo-6'),
      base: 'a'.repeat(40),
    } as unknown as Job;

    const prepared = await prepareWorkspace(contextWith(), job);

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.stage).toBe('worktree');
  });

  it('evicts the least recently used worktree beyond the limit', async () => {
    const context = contextWith({ worktreeLimit: 1 });
    const first = await prepareWorkspace(context, jobWith('old'));
    context.inUse.clear();
    await sleep(20);

    const second = await prepareWorkspace(context, jobWith('new'));

    expect(first.ok && existsSync(first.worktree)).toBe(false);
    expect(second.ok && existsSync(second.worktree)).toBe(true);
  });

  it('never evicts a worktree a job is using', async () => {
    const context = contextWith({ worktreeLimit: 1 });
    const first = await prepareWorkspace(context, jobWith('busy'));
    await sleep(20);

    await prepareWorkspace(context, jobWith('other'));

    expect(first.ok && existsSync(first.worktree)).toBe(true);
  });
});

describe('worktree path', () => {
  it('resolves a nested directory under the root', () => {
    expect(worktreePathOf('/data/worktrees/repo', 'todo/nested')).toBe(
      '/data/worktrees/repo/todo/nested',
    );
  });

  it('refuses a directory that climbs out of the root', () => {
    expect(() => worktreePathOf('/data/worktrees/repo', '../escape')).toThrow(
      /escapes/,
    );
  });
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Creates a mirror-shaped directory with a given `info/exclude` text. */
const mkdirForExclude = (mirror: string, text: string): void => {
  mkdirSync(join(mirror, 'info'), { recursive: true });
  writeFileSync(join(mirror, 'info', 'exclude'), text);
};
