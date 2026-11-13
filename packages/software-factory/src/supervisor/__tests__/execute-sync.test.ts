import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { execute } from '../execute';
import { harness, scratchRoot, todoText, type Harness } from './fixtures';

const SYNC = ['git fetch origin', 'git reset --hard origin/main'];

/** A task about to run its `setup` action, with every port call put on one timeline. */
const setupHarness = (): { h: Harness; timeline: string[] } => {
  const root = scratchRoot({ 'hello.md': todoText('todo') });
  const h = harness(root);
  h.store.createTask({
    taskId: 'hello',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  const timeline: string[] = [];
  const run = h.system.run.bind(h.system);
  h.system.run = async (input) => {
    timeline.push(`run ${input.cwd} :: ${input.command}`);
    return run(input);
  };
  const createWorktree = h.git.createWorktree.bind(h.git);
  h.git.createWorktree = async (input) => {
    timeline.push('createWorktree');
    return createWorktree(input);
  };
  return { h, timeline };
};

const finished = (h: Harness) =>
  h.store
    .events('hello')
    .flatMap((stored) =>
      stored.event.type === 'setup_finished' ? [stored.event] : [],
    );

describe('sync before worktree', () => {
  // FakeGit cannot model local main. Discarding local commits and edits is what
  // `git reset --hard origin/main` does, so the test proves that exact command
  // runs in the repo root, after the fetch and before any worktree exists.
  it('hard-resets the repo root to origin/main before createWorktree', async () => {
    const { h, timeline } = setupHarness();

    await execute(h.ports, 'hello', { type: 'setup' });

    const worktree = join(h.root, '.worktrees', 'hello');
    expect(timeline).toEqual([
      `run ${h.root} :: ${SYNC[0]}`,
      `run ${h.root} :: ${SYNC[1]}`,
      'createWorktree',
      `run ${worktree} :: pnpm install --frozen-lockfile`,
    ]);
    expect(finished(h)).toEqual([expect.objectContaining({ ok: true })]);
  });

  it('logs each sync step under the task evidence directory', async () => {
    const { h } = setupHarness();

    await execute(h.ports, 'hello', { type: 'setup' });

    const logs = h.system.calls
      .filter((call) => call.cwd === h.root)
      .map((call) => call.logPath);
    expect(logs).toEqual([
      join(h.root, '.evidences', 'hello', 'sync-0.log'),
      join(h.root, '.evidences', 'hello', 'sync-1.log'),
    ]);
  });

  it('fails setup and creates no worktree when a sync command exits non-zero', async () => {
    const { h, timeline } = setupHarness();
    h.system.results.set(SYNC[1] ?? '', {
      exitCode: 1,
      timedOut: false,
      durationMs: 0,
    });

    await execute(h.ports, 'hello', { type: 'setup' });

    expect(timeline).not.toContain('createWorktree');
    expect(h.git.calls.map((call) => call.method)).toEqual([]);
    expect(finished(h)).toEqual([
      expect.objectContaining({
        ok: false,
        log: join(h.root, '.evidences', 'hello', 'sync-1.log'),
      }),
    ]);
  });

  it('fails setup and creates no worktree when a sync command times out', async () => {
    const { h } = setupHarness();
    h.system.results.set(SYNC[0] ?? '', {
      exitCode: 0,
      timedOut: true,
      durationMs: 120_000,
    });

    await execute(h.ports, 'hello', { type: 'setup' });

    expect(h.git.calls).toEqual([]);
    expect(h.system.calls).toHaveLength(1);
    expect(finished(h)).toEqual([expect.objectContaining({ ok: false })]);
  });
});
