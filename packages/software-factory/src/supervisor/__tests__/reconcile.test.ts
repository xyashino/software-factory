import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentName } from '../names';
import { reconcile } from '../reconcile';
import { tick } from '../run';
import { harness, scratchRoot, todoText, type Harness } from './fixtures';
import { ScriptedHerdr, wireAgents } from './agents';

/** A task with setup done and one running agent attempt of `build`. */
const runningBuild = (root: string, paneAlive: boolean) => {
  const h = harness(root);
  h.store.createTask({
    taskId: 'hello',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  h.store.append('hello', {
    type: 'task_created',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  h.store.append('hello', { type: 'setup_started' });
  h.store.append('hello', { type: 'setup_finished', ok: true, log: 'l' });
  h.store.append('hello', {
    type: 'attempt_started',
    attemptId: 'att-1',
    stepId: 'build',
    n: 1,
    snapshotRef: 'refs/software-factory/hello/build/att-1',
    artifacts: { report: join(root, 'r.md') },
  });
  h.store.append('hello', {
    type: 'agent_ready',
    attemptId: 'att-1',
    pane: 'p',
    tab: 't',
  });
  if (paneAlive) {
    void h.herdr.startAgent({
      name: agentName('hello', 'build', 1),
      kind: 'claude',
      paneId: 'p',
      args: [],
      timeoutMs: 1,
    });
  }
  return h;
};

describe('restart reconciliation', () => {
  it('re-adopts a running attempt whose pane is still alive', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = runningBuild(root, true);
    await reconcile(h.ports);
    expect(h.store.events('hello').at(-1)?.event.type).toBe('agent_ready');
    expect(h.store.runningAttempt('hello', 'att-1')).toBeDefined();
  });

  it('records a crash when the pane is gone', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = runningBuild(root, false);
    await reconcile(h.ports);
    expect(h.store.events('hello').at(-1)?.event).toEqual(
      expect.objectContaining({
        type: 'attempt_failed',
        attemptId: 'att-1',
        reason: 'crashed',
      }),
    );
    expect(h.store.runningAttempt('hello', 'att-1')).toBeUndefined();
  });

  it('records a crash for an interrupted gate so the engine runs it again', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.store.createTask({
      taskId: 'hello',
      workflow: 'feature',
      todoPath: 'todos/hello.md',
      branch: 'factory/hello',
    });
    h.store.append('hello', { type: 'setup_started' });
    h.store.append('hello', { type: 'setup_finished', ok: true, log: 'l' });
    h.store.append('hello', {
      type: 'attempt_started',
      attemptId: 'gate-1',
      stepId: 'quality-gate',
      n: 1,
      snapshotRef: 'refs/software-factory/hello/quality-gate/gate-1',
      artifacts: {},
    });
    await reconcile(h.ports);
    expect(h.store.events('hello').at(-1)?.event).toEqual(
      expect.objectContaining({
        type: 'attempt_failed',
        attemptId: 'gate-1',
        reason: 'crashed',
      }),
    );
  });

  it('removes a half-made worktree when setup never finished', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.store.createTask({
      taskId: 'hello',
      workflow: 'feature',
      todoPath: 'todos/hello.md',
      branch: 'factory/hello',
    });
    h.store.append('hello', { type: 'setup_started' });
    await reconcile(h.ports);
    expect(h.git.calls.map((call) => call.method)).toEqual(['removeWorktree']);
  });

  it('reaches the same end whatever tick the supervisor was stopped at', async () => {
    const attemptsOf = (h: Harness): string[] =>
      h.store
        .events('hello')
        .flatMap((stored) =>
          stored.event.type === 'attempt_started'
            ? [`${stored.event.stepId}#${stored.event.n}`]
            : [],
        );
    const expected = [
      'plan#1',
      'plan-review#1',
      'build#1',
      'quality-gate#1',
      'audit#1',
    ];
    const boundaries = 40;
    for (let stopAfter = 0; stopAfter < boundaries; stopAfter++) {
      const root = scratchRoot({ 'hello.md': todoText('todo') });
      const h = harness(root);
      const herdr = new ScriptedHerdr();
      h.ports.herdr = herdr;
      wireAgents(h, herdr);
      for (let tickNo = 0; tickNo < stopAfter; tickNo++) {
        await tick(h.ports, () => undefined);
      }
      // Restart: a fresh supervisor reconciles the log, then carries on.
      await reconcile(h.ports);
      for (
        let tickNo = 0;
        tickNo < 300 && h.store.tasks()[0]?.status !== 'delivered';
        tickNo++
      ) {
        await tick(h.ports, () => undefined);
      }
      expect(
        h.store.tasks()[0]?.status,
        `stopped after ${stopAfter} ticks`,
      ).toBe('delivered');
      expect(attemptsOf(h), `stopped after ${stopAfter} ticks`).toEqual(
        expected,
      );
    }
  });
});
