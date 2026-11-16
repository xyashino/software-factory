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
import {
  checkpoint,
  validateOutputs,
  type CheckpointInput,
  type SendOutcome,
} from '../checkpoint';
import { runGit } from '../git';
import type { RunGit } from '../ports';
import { makeRemote, makeWorktree, must, scratch } from './helpers/git';

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

describe('checkpoint procedure (deferred commit, PROTOCOL §8.2)', () => {
  it('sends a passed Cycle at the worktree HEAD, committing and pushing nothing', async () => {
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
    expect(sent).toEqual([`dry:${base}`, `real:${base}`]);
    expect(await must(worktree, ['rev-parse', 'HEAD'])).toBe(base);
    expect(
      await must(worktree, ['status', '--porcelain', '--untracked-files=all']),
    ).toContain('src/login.ts');
    const onRemote = await runGit(remote, [
      'rev-parse',
      '--verify',
      '-q',
      'refs/heads/factory/add-login',
    ]);
    expect(onRemote.code).not.toBe(0);
  });

  it('never sends for real when the dry run answers stale_epoch', async () => {
    writeFile('plan.md', '# plan\n');
    const sent: boolean[] = [];
    const result = await checkpoint(
      input({
        send: async (_commit, dryRun) => {
          sent.push(dryRun);
          return { ok: false, code: 'stale_epoch', message: 'epoch moved' };
        },
      }),
    );

    expect(result).toEqual({ status: 'fenced' });
    expect(sent).toEqual([true]);
  });

  it('leaves the tree intact on a precondition refusal', async () => {
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

  it('fails the Cycle as crashed on an unexpected dry-run refusal', async () => {
    writeFile('plan.md', '# plan\n');
    const result = await checkpoint(
      input({
        send: async () => ({ ok: false, code: 'internal', message: 'boom' }),
      }),
    );

    expect(result).toEqual({ status: 'failed', detail: 'boom' });
  });

  it('uploads the outputs once before the command is sent', async () => {
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

  it('a blocked Cycle with no outputs yet is sent, not refused', async () => {
    const result = await checkpoint(
      input({
        outcome: 'blocked',
        outputs: [{ key: 'plan', path: 'plan.md', required: true }],
      }),
    );
    expect(result.status).toBe('sent');
  });

  it('never runs git against a remote branch while checkpointing', async () => {
    writeFile('plan.md', '# plan\n');
    const calls: string[][] = [];
    const recording: RunGit = async (cwd, args, env) => {
      calls.push([...args]);
      return runGit(cwd, args, env);
    };
    await checkpoint(input({ git: recording }));

    expect(calls.flat()).not.toContain('commit');
    expect(calls.flat()).not.toContain('push');
    expect(calls.flat()).not.toContain('fetch');
  });
});
