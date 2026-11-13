import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IDLE_MS, NO_WORK_MS, tick } from '../run';
import { FakeSystem } from '../../testing/fake-system';
import { harness, scratchRoot, todoText, type Harness } from './fixtures';

/** Ticks until the task stops acting: the operator, if any, had its turn and the block is final. */
const tickUntilIdle = async (h: Harness): Promise<void> => {
  for (let i = 0; i < 20; i++) {
    if ((await tick(h.ports, () => undefined)) === IDLE_MS) return;
  }
  throw new Error('the task never settled');
};

describe('unexpected port failures', () => {
  it('blocks the task as infra and the loop keeps running', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.herdr.createWorkspace = async () => {
      throw new Error('herdr server is down');
    };
    for (let i = 0; i < 20 && h.store.tasks()[0]?.status !== 'blocked'; i++) {
      await tick(h.ports, () => undefined);
    }
    await tickUntilIdle(h);
    // The port error is a start failure; the engine retries once, then blocks as infra.
    const failures = h.store
      .events('hello')
      .flatMap((stored) =>
        stored.event.type === 'attempt_failed' ? [stored.event] : [],
      );
    expect(failures.every((event) => event.reason === 'start_failed')).toBe(
      true,
    );
    expect(failures[0]?.detail).toBe('herdr server is down');
    expect(h.store.tasks()[0]?.status).toBe('parked');
    expect(h.store.events('hello').at(-2)?.event).toEqual(
      expect.objectContaining({ type: 'blocked', reason: 'infra' }),
    );
    // A parked task releases the line: with no other todo the supervisor has no work.
    expect(await tick(h.ports, () => undefined)).toBe(NO_WORK_MS);
  });

  it('keeps a blocked task work on a draft [BLOCKED] PR when it has changes', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.git.changes = true;
    // The fake git does not create the worktree on disk; a real one exists by now.
    mkdirSync(join(root, '.worktrees', 'hello'), { recursive: true });
    h.herdr.createWorkspace = async () => {
      throw new Error('herdr server is down');
    };
    for (let i = 0; i < 20 && h.store.tasks()[0]?.status !== 'blocked'; i++) {
      await tick(h.ports, () => undefined);
    }
    await tickUntilIdle(h);
    expect(h.store.tasks()[0]?.status).toBe('parked');
    expect(h.deliverer.blockedCalls).toEqual([
      { taskId: 'hello', reason: 'infra' },
    ]);
    expect(h.store.events('hello').at(-1)?.event).toEqual({
      type: 'delivered_blocked',
      prUrl: 'https://example.test/pr/blocked-hello',
    });
    // The worktree stays for inspection: no cleanup on a block.
    expect(h.git.calls.map((call) => call.method)).not.toContain(
      'removeWorktree',
    );
  });

  it('turns an exception thrown inside a tick into an infra block', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const system = new FakeSystem();
    system.run = async () => {
      throw new Error('disk full');
    };
    const h = harness(root, system);
    const logs: string[] = [];
    await tick(h.ports, (line) => logs.push(line));
    expect(h.store.tasks()[0]?.status).toBe('blocked');
    expect(h.store.events('hello').at(-1)?.event).toEqual({
      type: 'blocked',
      reason: 'infra',
      detail: 'disk full',
    });
    expect(logs).toContain('hello: blocked (infra): disk full');
  });
});
