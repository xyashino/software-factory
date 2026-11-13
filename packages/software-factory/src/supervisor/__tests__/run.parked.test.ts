import { describe, expect, it } from 'vitest';
import { runUnblock } from '../../cli/commands/unblock';
import { openTask } from '../../cli/management';
import { NO_WORK_MS, tick } from '../run';
import {
  definitions,
  harness,
  scratchRoot,
  todoText,
  type Harness,
} from './fixtures';

/** A supervisor whose every task fails to start, so each one ends in a final block. */
const failingHarness = (
  names: string[],
  extra: Record<string, string> = {},
) => {
  const todos: Record<string, string> = { ...extra };
  for (const name of names) todos[`${name}.md`] = todoText('todo');
  const h = harness(scratchRoot(todos));
  h.herdr.createWorkspace = async () => {
    throw new Error('herdr server is down');
  };
  return h;
};

const statusOf = (h: Harness, taskId: string): string | undefined => {
  return h.store.tasks().find((row) => row.id === taskId)?.status;
};

/** Ticks until the task is parked. */
const tickUntilParked = async (
  h: Harness,
  taskId: string,
  log: (line: string) => void = () => undefined,
): Promise<void> => {
  for (let i = 0; i < 60 && statusOf(h, taskId) !== 'parked'; i++) {
    await tick(h.ports, log);
  }
  expect(statusOf(h, taskId)).toBe('parked');
};

const unblock = (h: Harness, taskId: string): string => {
  const task = openTask(h.store, taskId, {}, definitions.workflows);
  return runUnblock(task, undefined);
};

describe('a parked task', () => {
  it('leaves the line, so the next todo is picked', async () => {
    const h = failingHarness(['a-first', 'b-second']);
    const logs: string[] = [];

    await tickUntilParked(h, 'a-first', (line) => logs.push(line));
    await tick(h.ports, (line) => logs.push(line));

    expect(logs).toContain('picked todos/b-second.md as task b-second');
    expect(statusOf(h, 'a-first')).toBe('parked');
  });

  it('parks a final block that has no PR to show', async () => {
    const h = failingHarness(['a-first']);

    await tickUntilParked(h, 'a-first');

    expect(h.deliverer.blockedCalls).toEqual([]);
    expect(h.store.events('a-first').at(-1)?.event).toEqual({ type: 'parked' });
  });

  it('keeps its worktree and tabs: nothing is removed or closed', async () => {
    const h = failingHarness(['a-first']);

    await tickUntilParked(h, 'a-first');

    expect(h.git.calls.map((call) => call.method)).not.toContain(
      'removeWorktree',
    );
  });

  it('is queued by sf unblock, without pre-empting the running task', async () => {
    const h = failingHarness(['a-first', 'b-second']);
    await tickUntilParked(h, 'a-first');
    await tick(h.ports, () => undefined);
    expect(statusOf(h, 'b-second')).not.toBe('parked');

    unblock(h, 'a-first');
    const logs: string[] = [];
    await tick(h.ports, (line) => logs.push(line));

    expect(statusOf(h, 'a-first')).toBe('queued');
    expect(logs.join('\n')).not.toContain('resumed unblocked task');
  });

  it('runs before new todos once the line is free', async () => {
    const h = failingHarness(['a-first', 'b-second', 'c-third']);
    await tickUntilParked(h, 'a-first');
    await tick(h.ports, () => undefined);
    unblock(h, 'a-first');

    await tickUntilParked(h, 'b-second');
    const logs: string[] = [];
    await tick(h.ports, (line) => logs.push(line));

    expect(logs).toContain('resumed unblocked task a-first');
    expect(h.store.tasks().map((row) => row.id)).not.toContain('c-third');
  });

  it('keeps a todo that depends on it waiting', async () => {
    const h = failingHarness(['a-first'], {
      'b-second.md': todoText('todo', 'depends_on: [a-first]\n'),
    });

    await tickUntilParked(h, 'a-first');

    expect(await tick(h.ports, () => undefined)).toBe(NO_WORK_MS);
    expect(h.store.tasks().map((row) => row.id)).toEqual(['a-first']);
  });
});

describe('the circuit breaker', () => {
  it('pauses picking after 3 consecutive parked tasks', async () => {
    const h = failingHarness(['a', 'b', 'c', 'd']);
    const logs: string[] = [];

    for (const id of ['a', 'b', 'c']) {
      await tickUntilParked(h, id, (line) => logs.push(line));
    }
    const pause = await tick(h.ports, (line) => logs.push(line));
    await tick(h.ports, (line) => logs.push(line));

    expect(pause).toBe(NO_WORK_MS);
    expect(h.store.tasks().map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(logs.filter((line) => line.startsWith('[CIRCUIT BREAKER]'))).toEqual(
      [
        '[CIRCUIT BREAKER] 3 consecutive tasks parked. Pausing supervisor loop.',
      ],
    );
  });

  it('resumes when a human unblocks a parked task', async () => {
    const h = failingHarness(['a', 'b', 'c', 'd']);
    for (const id of ['a', 'b', 'c']) await tickUntilParked(h, id);
    await tick(h.ports, () => undefined);

    unblock(h, 'a');
    const logs: string[] = [];
    const pause = await tick(h.ports, (line) => logs.push(line));

    expect(logs).toContain('resumed unblocked task a');
    expect(pause).not.toBe(NO_WORK_MS);
  });
});
