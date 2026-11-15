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
import type { SystemPort } from '../ports/system.port';
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

describe('workspace shared by every job of a Work order', () => {
  it('gives every job of one Work order the same worktree', async () => {
    const operator = await prepareWorkspace(contextWith(), jobWith('todo-9'));
    const inspection = await prepareWorkspace(contextWith(), jobWith('todo-9'));

    expect(operator.ok && inspection.ok).toBe(true);
    if (!operator.ok || !inspection.ok) return;
    expect(inspection.worktree).toBe(operator.worktree);
  });

  it('places two Work orders of one repo at once on a fresh Cell, both ok', async () => {
    // Both prepares clone the mirror; the mirror lock runs them in turn, so the second sees the first clone.
    const [first, second] = await Promise.all([
      prepareWorkspace(contextWith(), jobWith('par-a')),
      prepareWorkspace(contextWith(), jobWith('par-b')),
    ]);

    expect(first.ok && second.ok).toBe(true);
  });

  it('reports a failing sync at the sync stage', async () => {
    const prepared = await prepareWorkspace(
      contextWith(),
      jobWith('todo-10', [], ['exit 2']),
    );

    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.stage).toBe('sync');
  });

  it('resets an existing worktree to the base and removes leftovers', async () => {
    const first = await prepareWorkspace(contextWith(), jobWith('todo-11'));
    if (!first.ok) throw new Error(first.detail);
    writeFileSync(join(first.worktree, 'leftover.md'), 'from the last Cycle');

    const again = await prepareWorkspace(contextWith(), jobWith('todo-11'));

    expect(again.ok).toBe(true);
    expect(existsSync(join(first.worktree, 'leftover.md'))).toBe(false);
  });
});

describe('fetch of the remote', () => {
  /** A system port that records every command it runs, and runs it for real. */
  const recordingSystem = () => {
    const real = createSystemAdapter();
    const commands: string[] = [];
    const system: SystemPort = {
      ...real,
      run: (input) => {
        commands.push(input.command);
        return real.run(input);
      },
    };
    return {
      commands,
      context: contextWith({
        shell: { system, logDir: join(cellDataDir, 'logs', 'fetch') },
      }),
    };
  };
  const fetches = (commands: readonly string[]): number =>
    commands.filter((command) => command.includes("'fetch'")).length;

  it('skips the fetch when a pinned base is already in the mirror', async () => {
    const head = git(origin, 'rev-parse', 'HEAD');
    await prepareWorkspace(contextWith(), jobWith('pin-1'));
    const recorded = recordingSystem();

    const prepared = await prepareWorkspace(recorded.context, {
      ...jobWith('pin-1'),
      base: head,
    } as unknown as Job);

    expect(prepared).toMatchObject({ ok: true, head });
    expect(fetches(recorded.commands)).toBe(0);
  });

  it('fetches when a pinned base is not in the mirror yet', async () => {
    await prepareWorkspace(contextWith(), jobWith('pin-2'));
    const next = commitFile(origin, 'pinned.txt', 'pinned\n');
    const recorded = recordingSystem();

    const prepared = await prepareWorkspace(recorded.context, {
      ...jobWith('pin-2'),
      base: next,
    } as unknown as Job);

    expect(prepared).toMatchObject({ ok: true, head: next });
    expect(fetches(recorded.commands)).toBe(1);
  });

  it('fetches for a pinned base when the caller always fetches (deliver)', async () => {
    const head = git(origin, 'rev-parse', 'HEAD');
    await prepareWorkspace(contextWith(), jobWith('pin-3'));
    const recorded = recordingSystem();

    await prepareWorkspace({ ...recorded.context, alwaysFetch: true }, {
      ...jobWith('pin-3'),
      base: head,
    } as unknown as Job);

    expect(fetches(recorded.commands)).toBe(1);
  });

  it('always fetches for a branch base', async () => {
    await prepareWorkspace(contextWith(), jobWith('branch-1'));
    const recorded = recordingSystem();

    await prepareWorkspace(recorded.context, jobWith('branch-1'));

    expect(fetches(recorded.commands)).toBe(1);
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
