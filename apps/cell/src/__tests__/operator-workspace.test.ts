import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import type { RunShell } from '../ports';
import { prepareWorkspace } from '../workspace';
import { makeRemote, must, scratch } from './helpers/git';

let dir: string;
let remote: string;
let base: string;

beforeEach(async () => {
  dir = scratch('workspace');
  ({ remote, base } = await makeRemote(dir));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A job as the Cell receives it, pointing at the fixture remote. */
const jobFor = (overrides: Partial<Job> = {}): Job =>
  ({
    jobId: '01J0000000000000000000000J',
    orderId: 'software-factory:add-login',
    projectId: 'software-factory',
    epoch: 1,
    kind: 'run_operator_station',
    repo: { url: remote, baseBranch: 'main', branch: 'factory/add-login' },
    base,
    workspace: { dir: 'worktree', sync: [], setup: [], timeoutMs: 60_000 },
    ...overrides,
  }) as Job;

describe('operator workspace', () => {
  it('creates the worktree at the base commit on the Work order branch', async () => {
    const result = await prepareWorkspace({
      job: jobFor(),
      dataDir: join(dir, 'cell'),
    });

    expect(result).toMatchObject({ ok: true, base });
    if (!result.ok) return;
    expect(await must(result.worktree, ['rev-parse', 'HEAD'])).toBe(base);
    expect(
      await must(result.worktree, ['rev-parse', '--abbrev-ref', 'HEAD']),
    ).toBe('factory/add-login');
    expect(existsSync(join(result.worktree, '.cell'))).toBe(true);
  });

  it('keeps the .cell directory out of the commits, through the mirror exclude file', async () => {
    const result = await prepareWorkspace({
      job: jobFor(),
      dataDir: join(dir, 'cell'),
    });
    if (!result.ok) throw new Error(result.detail);
    writeFileSync(
      join(result.worktree, '.cell', 'scratch.txt'),
      'never committed',
    );
    writeFileSync(join(result.worktree, 'plan.md'), '# plan\n');

    expect(await must(result.worktree, ['status', '--porcelain'])).toBe(
      '?? plan.md',
    );
  });

  it('resolves a branch-based base to the remote branch tip', async () => {
    const result = await prepareWorkspace({
      job: jobFor({ base: { branchBase: 'main' } } as never),
      dataDir: join(dir, 'cell'),
    });

    expect(result).toMatchObject({ ok: true, base });
  });

  it('reports a fetch failure with the stage it failed at', async () => {
    const result = await prepareWorkspace({
      job: jobFor({
        repo: {
          url: join(dir, 'missing.git'),
          baseBranch: 'main',
          branch: 'b',
        },
      } as never),
      dataDir: join(dir, 'cell'),
    });

    expect(result).toMatchObject({ ok: false, stage: 'fetch' });
  });

  it('reports a missing base branch at the worktree stage', async () => {
    const result = await prepareWorkspace({
      job: jobFor({ base: { branchBase: 'no-such-branch' } } as never),
      dataDir: join(dir, 'cell'),
    });

    expect(result).toMatchObject({ ok: false, stage: 'worktree' });
  });

  it('resets an existing worktree to the base and removes the Operator leftovers', async () => {
    const dataDir = join(dir, 'cell');
    const first = await prepareWorkspace({ job: jobFor(), dataDir });
    if (!first.ok) throw new Error(first.detail);
    writeFileSync(join(first.worktree, 'leftover.md'), 'from the last Cycle');

    const again = await prepareWorkspace({ job: jobFor(), dataDir });

    expect(again).toMatchObject({ ok: true });
    expect(existsSync(join(first.worktree, 'leftover.md'))).toBe(false);
    expect(readFileSync(join(first.worktree, 'README.md'), 'utf8')).toBe(
      '# fixture\n',
    );
  });

  describe('sync and setup', () => {
    /** A shell that records each line it runs, and fails the lines named in `failing`. */
    const recordingShell = (failing: string[] = []) => {
      const ran: { cwd: string; command: string; timeoutMs: number }[] = [];
      const shell: RunShell = async (cwd, command, timeoutMs) => {
        ran.push({ cwd, command, timeoutMs });
        return failing.includes(command)
          ? { ok: false, detail: `${command} failed` }
          : { ok: true, detail: '' };
      };
      return { ran, shell };
    };

    it('runs sync, then setup, in the worktree with the workspace timeout', async () => {
      const { ran, shell } = recordingShell();
      const result = await prepareWorkspace({
        job: jobFor({
          workspace: {
            dir: 'worktree',
            sync: ['pnpm fetch'],
            setup: ['pnpm install', 'pnpm build'],
            timeoutMs: 5_000,
          },
        } as never),
        dataDir: join(dir, 'cell'),
        shell,
      });

      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(ran).toEqual([
        { cwd: result.worktree, command: 'pnpm fetch', timeoutMs: 5_000 },
        { cwd: result.worktree, command: 'pnpm install', timeoutMs: 5_000 },
        { cwd: result.worktree, command: 'pnpm build', timeoutMs: 5_000 },
      ]);
    });

    it('skips sync and setup when the worktree is already prepared at the same base', async () => {
      const dataDir = join(dir, 'cell');
      const job = jobFor({
        workspace: {
          dir: 'worktree',
          sync: [],
          setup: ['pnpm install'],
          timeoutMs: 5_000,
        },
      } as never);
      const first = recordingShell();
      await prepareWorkspace({ job, dataDir, shell: first.shell });
      const again = recordingShell();

      const result = await prepareWorkspace({
        job,
        dataDir,
        shell: again.shell,
      });

      expect(result).toMatchObject({ ok: true });
      expect(first.ran).toHaveLength(1);
      expect(again.ran).toHaveLength(0);
    });

    it('reports a failing sync at the sync stage and runs no setup', async () => {
      const { ran, shell } = recordingShell(['pnpm fetch']);
      const result = await prepareWorkspace({
        job: jobFor({
          workspace: {
            dir: 'worktree',
            sync: ['pnpm fetch'],
            setup: ['pnpm install'],
            timeoutMs: 5_000,
          },
        } as never),
        dataDir: join(dir, 'cell'),
        shell,
      });

      expect(result).toMatchObject({ ok: false, stage: 'sync' });
      expect(ran.map((line) => line.command)).toEqual(['pnpm fetch']);
    });

    it('reports a failing setup at the setup stage and does not mark the worktree prepared', async () => {
      const dataDir = join(dir, 'cell');
      const job = jobFor({
        workspace: {
          dir: 'worktree',
          sync: [],
          setup: ['pnpm install'],
          timeoutMs: 5_000,
        },
      } as never);
      const failed = recordingShell(['pnpm install']);

      const result = await prepareWorkspace({
        job,
        dataDir,
        shell: failed.shell,
      });
      expect(result).toMatchObject({ ok: false, stage: 'setup' });

      const retry = recordingShell();
      const again = await prepareWorkspace({
        job,
        dataDir,
        shell: retry.shell,
      });
      expect(again).toMatchObject({ ok: true });
      expect(retry.ran.map((line) => line.command)).toEqual(['pnpm install']);
    });
  });
});
