import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandResult } from '@repo/factory-core/contracts/cell';
import type { CommitSha } from '@repo/factory-core/ids';
import {
  checkpoint,
  commitMessage,
  pushWip,
  trailers,
  validateOutputs,
  type CheckpointInput,
  type SendOutcome,
} from '../checkpoint';
import { runGit } from '../git';
import type { RunGit } from '../ports';
import {
  commitOf,
  makeRemote,
  makeWorktree,
  must,
  scratch,
} from './helpers/git';

const ORDER = 'software-factory:add-login';
const CYCLE = '01J0000000000000000000000C';
const EMPTY_RESULT: CommandResult = { dryRun: false, events: [], next: null };
const ok: SendOutcome = { ok: true, result: EMPTY_RESULT };

let dir: string;
let remote: string;
let base: string;
let worktree: string;

beforeEach(async () => {
  dir = scratch('checkpoint');
  ({ remote, base } = await makeRemote(dir));
  worktree = await makeWorktree(dir, remote, base, 'factory/add-login');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The checkpoint input of an Operator that wrote one file and finished. */
const input = (overrides: Partial<CheckpointInput> = {}): CheckpointInput => ({
  worktree,
  git: runGit,
  todoId: 'add-login',
  orderId: ORDER,
  stationId: 'build',
  n: 1,
  cycleId: CYCLE,
  epoch: 3,
  outcome: 'passed',
  outputs: [],
  upload: async () => undefined,
  send: async () => ok,
  ...overrides,
});

const writeFile = (path: string, text: string) => {
  mkdirSync(join(worktree, path, '..'), { recursive: true });
  writeFileSync(join(worktree, path), text);
};

describe('checkpoint trailers', () => {
  it('names the order, station, Cycle, epoch and outcome in that order', () => {
    expect(
      trailers({
        orderId: ORDER,
        stationId: 'build',
        cycleId: CYCLE,
        epoch: 3,
        outcome: 'handed_over',
      }),
    ).toEqual([
      `Factory-Order: ${ORDER}`,
      'Factory-Station: build',
      `Factory-Cycle: ${CYCLE}`,
      'Factory-Epoch: 3',
      'Factory-Outcome: handed_over',
    ]);
  });

  it('titles the commit as the Station and Cycle number, with the trailers as body', () => {
    const message = commitMessage({
      orderId: ORDER,
      stationId: 'build',
      n: 2,
      cycleId: CYCLE,
      epoch: 3,
      outcome: 'failed',
    });
    expect(message.subject).toBe('wip(build): cycle 2');
    expect(message.body).toContain('Factory-Outcome: failed');
  });
});

describe('validateOutputs', () => {
  it('accepts a non-empty output that exists', async () => {
    writeFile('out/plan.md', '# plan\n');
    expect(
      await validateOutputs(worktree, [
        { key: 'plan', path: 'out/plan.md', required: true },
      ]),
    ).toEqual([]);
  });

  it('reports a required output that is missing, but not an optional one', async () => {
    expect(
      await validateOutputs(worktree, [
        { key: 'plan', path: 'plan.md', required: true },
      ]),
    ).toEqual(['output "plan" is missing']);
    expect(
      await validateOutputs(worktree, [
        { key: 'notes', path: 'notes.md', required: false },
      ]),
    ).toEqual([]);
  });

  it('reports an empty output', async () => {
    writeFile('plan.md', '');
    expect(
      await validateOutputs(worktree, [
        { key: 'plan', path: 'plan.md', required: true },
      ]),
    ).toEqual(['output "plan" is empty']);
  });

  it('refuses an output that resolves outside the worktree through a symlink', async () => {
    const outside = join(dir, 'outside.md');
    writeFileSync(outside, 'secret');
    symlinkSync(outside, join(worktree, 'link.md'));
    expect(
      await validateOutputs(worktree, [
        { key: 'link', path: 'link.md', required: true },
      ]),
    ).toEqual(['output "link" resolves outside the worktree']);
  });

  it('accepts an output in the Cell scratch directory, which is never committed', async () => {
    writeFile('.cell/outputs/out.md', 'x');
    expect(
      await validateOutputs(worktree, [
        { key: 'out', path: '.cell/outputs/out.md', required: true },
      ]),
    ).toEqual([]);
  });
});

describe('checkpoint procedure', () => {
  it('commits, pushes and sends a passed Cycle, the commit trailers on the remote branch', async () => {
    writeFile('src/login.ts', 'export const login = 1;\n');
    const sent: string[] = [];
    const result = await checkpoint(
      input({
        send: async (commit, dryRun) => {
          sent.push(`${dryRun ? 'dry' : 'real'}:${commit}`);
          return ok;
        },
      }),
    );

    expect(result.status).toBe('sent');
    const onRemote = await commitOf(remote, 'refs/heads/factory/add-login');
    expect(onRemote.subject).toBe('wip(build): cycle 1');
    expect(onRemote.body).toContain('Factory-Outcome: passed');
    expect(onRemote.body).toContain('Factory-Epoch: 3');
    expect(sent).toEqual([`dry:${onRemote.sha}`, `real:${onRemote.sha}`]);
    expect(await must(remote, ['show', `${onRemote.sha}:src/login.ts`])).toBe(
      'export const login = 1;',
    );
  });

  it('creates the branch on the first push, when no branch exists on the remote', async () => {
    writeFile('plan.md', '# plan\n');
    const branches = await must(remote, [
      'branch',
      '--list',
      'factory/add-login',
    ]);
    expect(branches).toBe('');

    const result = await checkpoint(input());

    expect(result.status).toBe('sent');
    expect(
      await must(remote, [
        'rev-parse',
        '--verify',
        'refs/heads/factory/add-login',
      ]),
    ).toMatch(/^[0-9a-f]{40}$/);
  });

  it('never pushes when the dry run answers stale_epoch', async () => {
    writeFile('plan.md', '# plan\n');
    const result = await checkpoint(
      input({
        send: async () => ({
          ok: false,
          code: 'stale_epoch',
          message: 'epoch moved',
        }),
      }),
    );

    expect(result).toEqual({ status: 'fenced' });
    const branch = await runGit(remote, [
      'rev-parse',
      '--verify',
      '-q',
      'refs/heads/factory/add-login',
    ]);
    expect(branch.code).not.toBe(0);
  });

  it('drops its local commit on a precondition refusal and keeps the tree intact', async () => {
    writeFile('plan.md', '# plan\n');
    const result = await checkpoint(
      input({
        send: async () => ({
          ok: false,
          code: 'precondition',
          message: 'the Cycle is not live',
        }),
      }),
    );

    expect(result).toEqual({
      status: 'rejected',
      detail: 'the Cycle is not live',
    });
    expect(await must(worktree, ['rev-parse', 'HEAD'])).toBe(base);
    expect(readFileSync(join(worktree, 'plan.md'), 'utf8')).toBe('# plan\n');
    expect(await must(worktree, ['status', '--porcelain'])).toContain(
      'plan.md',
    );
  });

  it('retries the push once when the tip moved, then sends', async () => {
    writeFile('plan.md', '# plan\n');
    await must(remote, ['update-ref', 'refs/heads/factory/add-login', base]);
    let raced = false;
    const racing: RunGit = async (cwd, args, env) => {
      if (
        !raced &&
        args.includes('push') &&
        args.some((a) => a.startsWith('--force-with-lease'))
      ) {
        raced = true;
        const seed = join(dir, 'racer');
        await must(dir, ['clone', '--quiet', remote, seed]);
        await must(seed, [
          'commit',
          '--quiet',
          '--allow-empty',
          '-m',
          'someone else',
        ]);
        await must(seed, [
          'push',
          '--quiet',
          'origin',
          'HEAD:refs/heads/factory/add-login',
          '--force',
        ]);
      }
      return runGit(cwd, args, env);
    };

    const result = await checkpoint(input({ git: racing }));

    expect(result.status).toBe('sent');
    const onRemote = await commitOf(remote, 'refs/heads/factory/add-login');
    expect(onRemote.body).toContain('Factory-Outcome: passed');
  });

  it('fails the Cycle as crashed after three rejected pushes', async () => {
    writeFile('plan.md', '# plan\n');
    let pushes = 0;
    const alwaysRejected: RunGit = async (cwd, args, env) => {
      if (
        args.includes('push') &&
        args.some((a) => a.startsWith('--force-with-lease'))
      ) {
        pushes += 1;
        return { code: 1, stdout: '', stderr: 'stale info' };
      }
      return runGit(cwd, args, env);
    };

    const result = await checkpoint(input({ git: alwaysRejected }));

    expect(pushes).toBe(3);
    expect(result.status).toBe('failed');
  });

  it('uploads the outputs once before the commit', async () => {
    writeFile('plan.md', '# plan\n');
    let uploaded = 0;
    await checkpoint(
      input({
        upload: async () => {
          uploaded += 1;
        },
      }),
    );
    expect(uploaded).toBe(1);
  });
});

describe('pushWip', () => {
  it('pushes the failed Cycle WIP to its own ref and leaves the branch where it was', async () => {
    writeFile('draft.md', 'half done\n');
    const sha = await pushWip({
      worktree,
      git: runGit,
      todoId: 'add-login',
      orderId: ORDER,
      stationId: 'build',
      n: 1,
      cycleId: CYCLE,
      epoch: 3,
    });

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const wip = await commitOf(
      remote,
      `refs/heads/factory-wip/add-login/${CYCLE}`,
    );
    expect(wip.body).toContain('Factory-Outcome: failed');
    expect(await must(worktree, ['rev-parse', 'HEAD'])).toBe(base);
    expect(sha as CommitSha).toBe(wip.sha as CommitSha);
  });
});
