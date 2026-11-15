import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { worktreePathOf, worktreeRootOf } from '../workspace/worktree';
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

/** A system that records each command it runs, then runs it for real. */
const recordingSystem = (): { commands: string[]; system: SystemPort } => {
  const real = createSystemAdapter();
  const commands: string[] = [];
  return {
    commands,
    system: {
      run: (input) => {
        commands.push(input.command);
        return real.run(input);
      },
    },
  };
};

/** A job with only the fields the workspace reads. */
const jobWith = (dir: string, setup: string[] = [], sync: string[] = []): Job =>
  ({
    jobId: '01J0000000000000000000000J',
    kind: 'run_operator_station',
    orderId: `software-factory:${dir}`,
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

const mirrorsOf = (): string[] => readdirSync(join(cellDataDir, 'mirrors'));

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
  it('puts the worktree detached at the branch base and reports its HEAD', async () => {
    const head = git(origin, 'rev-parse', 'HEAD');

    const prepared = await prepareWorkspace(contextWith(), jobWith('todo-1'));

    expect(prepared).toMatchObject({ ok: true, head });
    if (!prepared.ok) return;
    expect(git(prepared.worktree, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(prepared.worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      'HEAD',
    );
    expect(existsSync(join(prepared.worktree, '.cell'))).toBe(true);
  });

  it('resolves a branch-based base to the mirror branch tip', async () => {
    const head = git(origin, 'rev-parse', 'HEAD');

    const prepared = await prepareWorkspace(
      contextWith(),
      jobWith('todo-base'),
    );

    expect(prepared).toMatchObject({ ok: true, head });
  });

  it('keeps the .cell directory out of the status of the worktree', async () => {
    const prepared = await prepareWorkspace(
      contextWith(),
      jobWith('todo-cell'),
    );
    if (!prepared.ok) throw new Error(prepared.detail);
    writeFileSync(
      join(prepared.worktree, '.cell', 'scratch.txt'),
      'never committed',
    );
    writeFileSync(join(prepared.worktree, 'plan.md'), '# plan\n');

    expect(git(prepared.worktree, 'status', '--porcelain')).toBe('?? plan.md');
  });

  it('reports a fetch failure with the stage it failed at', async () => {
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

  it('reports a missing base branch at the worktree stage', async () => {
    const job = {
      ...jobWith('todo-missing'),
      base: { branchBase: 'no-such-branch' },
    } as Job;

    const prepared = await prepareWorkspace(contextWith(), job);

    expect(prepared).toMatchObject({ ok: false, stage: 'worktree' });
  });

  it('reports a pinned base the mirror does not have as a worktree failure', async () => {
    const job = { ...jobWith('todo-6'), base: 'a'.repeat(40) } as Job;

    const prepared = await prepareWorkspace(contextWith(), job);

    expect(prepared).toMatchObject({ ok: false, stage: 'worktree' });
  });

  it('refuses a Mechanic job, which never gets a worktree', async () => {
    const job = { ...jobWith('todo-m'), kind: 'mechanic' } as Job;

    await expect(prepareWorkspace(contextWith(), job)).rejects.toThrow(
      'has no worktree',
    );
  });

  it('resets an existing worktree to the base and removes the Operator leftovers', async () => {
    const first = await prepareWorkspace(contextWith(), jobWith('todo-reset'));
    if (!first.ok) throw new Error(first.detail);
    writeFileSync(join(first.worktree, 'leftover.md'), 'from the last Cycle');

    const again = await prepareWorkspace(contextWith(), jobWith('todo-reset'));

    expect(again).toMatchObject({ ok: true });
    expect(existsSync(join(first.worktree, 'leftover.md'))).toBe(false);
    expect(readFileSync(join(first.worktree, 'README.md'), 'utf8')).toBe(
      '# repo\n',
    );
  });
});

describe('one workspace per Cell', () => {
  it('prepares two Work orders of one repo at once on a fresh Cell, both ok, one mirror', async () => {
    // Two preparations of one Cell run at once: the mirror lock makes the first clone finish first.
    const [first, second] = await Promise.all([
      prepareWorkspace(contextWith(), jobWith('todo-add-login')),
      prepareWorkspace(contextWith(), jobWith('todo-add-logout')),
    ]);

    expect(first.ok && second.ok).toBe(true);
    expect(mirrorsOf()).toHaveLength(1);
  });

  it('gives station, inspection and delivery of one order the same worktree, cloned and installed once', async () => {
    const job = jobWith('todo-shared', [countSetup()]);

    const station = await prepareWorkspace(contextWith(), job);
    const inspection = await prepareWorkspace(contextWith(), {
      ...job,
      jobId: '01J0000000000000000000000K',
      kind: 'run_inspection',
    } as Job);
    const deliver = await prepareWorkspace(contextWith(), {
      ...job,
      jobId: '01J0000000000000000000000L',
      kind: 'deliver',
    } as Job);

    expect(station.ok && inspection.ok && deliver.ok).toBe(true);
    if (!station.ok || !inspection.ok || !deliver.ok) return;
    expect(inspection.worktree).toBe(station.worktree);
    expect(deliver.worktree).toBe(station.worktree);
    expect(mirrorsOf()).toHaveLength(1);
    expect(setupRuns()).toBe(1);
  });

  it('gives two Work orders of one repo two worktrees under one mirror', async () => {
    await prepareWorkspace(contextWith(), jobWith('todo-x'));
    await prepareWorkspace(contextWith(), jobWith('todo-y'));

    const root = worktreeRootOf(cellDataDir, mirrorPathOf(cellDataDir, origin));
    expect(readdirSync(root).sort()).toEqual(['todo-x', 'todo-y']);
    expect(mirrorsOf()).toHaveLength(1);
  });

  it('keeps a worktree that a job holds, and evicts the least recently used beyond the limit', async () => {
    const context = contextWith({ worktreeLimit: 1 });
    const busy = await prepareWorkspace(context, jobWith('busy'));
    await sleep(20);

    await prepareWorkspace(context, jobWith('other'));

    expect(busy.ok && existsSync(busy.worktree)).toBe(true);
    context.inUse.clear();
    await sleep(20);
    await prepareWorkspace(context, jobWith('third'));
    expect(busy.ok && existsSync(busy.worktree)).toBe(false);
  });
});

describe('fetch skip', () => {
  it('fetches the remote for a branch base, every time', async () => {
    await prepareWorkspace(contextWith(), jobWith('todo-fetch-branch'));
    const recorded = recordingSystem();
    const context = contextWith({
      shell: { system: recorded.system, logDir: join(root, 'logs') },
    });

    await prepareWorkspace(context, jobWith('todo-fetch-branch'));

    expect(recorded.commands.some((c) => c.includes("'fetch'"))).toBe(true);
  });

  it('always fetches for delivery, even when the pinned base is in the mirror', async () => {
    await prepareWorkspace(contextWith(), jobWith('todo-deliver-warm'));
    const pinned = git(origin, 'rev-parse', 'HEAD');
    const recorded = recordingSystem();
    const context = contextWith({
      shell: { system: recorded.system, logDir: join(root, 'logs') },
    });

    await prepareWorkspace(context, {
      ...jobWith('todo-deliver-warm'),
      kind: 'deliver',
      base: pinned,
    } as Job);

    expect(recorded.commands.some((c) => c.includes("'fetch'"))).toBe(true);
  });

  it('skips the remote fetch when the pinned base is already in the mirror', async () => {
    await prepareWorkspace(contextWith(), jobWith('todo-warm'));
    const pinned = git(origin, 'rev-parse', 'HEAD');
    const recorded = recordingSystem();
    const context = contextWith({
      shell: { system: recorded.system, logDir: join(root, 'logs') },
    });

    const prepared = await prepareWorkspace(context, {
      ...jobWith('todo-pinned'),
      base: pinned,
    } as Job);

    expect(prepared).toMatchObject({ ok: true, head: pinned });
    expect(recorded.commands.some((c) => c.includes("'fetch'"))).toBe(false);
  });

  it('fetches when the pinned base is not in the mirror yet', async () => {
    await prepareWorkspace(contextWith(), jobWith('todo-before'));
    const next = commitFile(origin, 'next.txt', 'next\n');
    const recorded = recordingSystem();
    const context = contextWith({
      shell: { system: recorded.system, logDir: join(root, 'logs') },
    });

    const prepared = await prepareWorkspace(context, {
      ...jobWith('todo-after'),
      base: next,
    } as Job);

    expect(prepared).toMatchObject({ ok: true, head: next });
    expect(recorded.commands.some((c) => c.includes("'fetch'"))).toBe(true);
  });
});

describe('sync and setup', () => {
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

  it('runs sync before setup, in the worktree', async () => {
    const order = join(root, 'order.txt');
    const line = (name: string): string =>
      `echo ${name} >> ${shellQuote(order)}`;

    const prepared = await prepareWorkspace(
      contextWith(),
      jobWith('todo-order', [line('setup')], [line('sync')]),
    );

    expect(prepared.ok).toBe(true);
    expect(readFileSync(order, 'utf8')).toBe('sync\nsetup\n');
  });

  it('reports a failing sync at the sync stage and runs no setup', async () => {
    const prepared = await prepareWorkspace(
      contextWith(),
      jobWith('todo-sync', [countSetup()], ['exit 2']),
    );

    expect(prepared).toMatchObject({ ok: false, stage: 'sync' });
    expect(setupRuns()).toBe(0);
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

  it('does not mark a worktree with a failed setup as prepared', async () => {
    const failed = await prepareWorkspace(
      contextWith(),
      jobWith('todo-retry', ['exit 3']),
    );
    expect(failed).toMatchObject({ ok: false, stage: 'setup' });

    const again = await prepareWorkspace(
      contextWith(),
      jobWith('todo-retry', [countSetup()]),
    );

    expect(again).toMatchObject({ ok: true });
    expect(setupRuns()).toBe(1);
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
