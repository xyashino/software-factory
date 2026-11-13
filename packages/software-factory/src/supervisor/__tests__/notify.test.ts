import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { worktreeDir } from '../../paths';
import type { TaskRow } from '../../ports/store.port';
import { publishBlockedWork } from '../blocked-work';
import { tick } from '../run';
import {
  harness,
  readText,
  scratchRoot,
  todoText,
  type Harness,
} from './fixtures';
import { ScriptedHerdr, wireAgents } from './agents';

const BLOCKED_TASK: TaskRow = {
  id: 'hello',
  workflow: 'feature',
  todoPath: 'todos/hello.md',
  branch: 'factory/hello',
  status: 'blocked',
  createdAt: 1,
  updatedAt: 1,
};

const deliverHello = async (h: Harness): Promise<void> => {
  for (let i = 0; i < 300 && h.store.tasks()[0]?.status !== 'delivered'; i++) {
    await tick(h.ports, () => undefined);
  }
};

const deliveringHarness = (): { h: Harness; herdr: ScriptedHerdr } => {
  const root = scratchRoot({ 'hello.md': todoText('todo') });
  const h = harness(root);
  const herdr = new ScriptedHerdr();
  h.ports.herdr = herdr;
  wireAgents(h, herdr);
  return { h, herdr };
};

const blockedHarness = (): Harness => {
  const root = scratchRoot({ 'hello.md': todoText('todo') });
  const h = harness(root);
  mkdirSync(worktreeDir(root, 'hello'), { recursive: true });
  h.store.createTask({
    taskId: 'hello',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  return h;
};

describe('delivery notifications', () => {
  it('toasts the PR url with the done sound when a task is delivered', async () => {
    const { h, herdr } = deliveringHarness();

    await deliverHello(h);

    expect(herdr.notifications).toEqual([
      {
        title: 'Task Delivered: hello',
        options: { body: 'https://example.test/pull/1', sound: 'done' },
      },
    ]);
  });

  it('still delivers and logs when herdr refuses the toast', async () => {
    const { h, herdr } = deliveringHarness();
    herdr.notifyError = new Error('herdr is gone');

    await deliverHello(h);

    expect(h.store.tasks()[0]?.status).toBe('delivered');
    expect(
      readText(join(h.root, '.evidences', 'hello', 'notify.log')),
    ).toContain('herdr is gone');
    expect(herdr.calls.map((call) => call.method)).toContain('closeWorkspace');
  });

  it('toasts the blocked PR with the request sound', async () => {
    const h = blockedHarness();
    h.git.changes = true;

    await publishBlockedWork(h.ports, BLOCKED_TASK, 'infra', 'x');

    expect(h.herdr.notifications).toEqual([
      {
        title: 'Task Blocked: hello',
        options: {
          body: 'PR [BLOCKED]: https://example.test/pr/blocked-hello',
          sound: 'request',
        },
      },
    ]);
  });

  it('does not toast a blocked task that has no work to publish', async () => {
    const h = blockedHarness();
    h.git.changes = false;

    await publishBlockedWork(h.ports, BLOCKED_TASK, 'infra', 'x');

    expect(h.herdr.notifications).toEqual([]);
  });

  it('keeps the blocked PR recorded and writes no PR failure log when the toast fails', async () => {
    const h = blockedHarness();
    h.git.changes = true;
    h.herdr.notifyError = new Error('herdr is gone');

    await publishBlockedWork(h.ports, BLOCKED_TASK, 'infra', 'x');

    expect(h.deliverer.blockedCalls).toHaveLength(1);
    expect(
      existsSync(join(h.root, '.evidences', 'hello', 'blocked-pr.log')),
    ).toBe(false);
    expect(existsSync(join(h.root, '.evidences', 'hello', 'notify.log'))).toBe(
      true,
    );
  });
});
