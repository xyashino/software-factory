import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCaller } from '../../cli/caller';
import { runAnswer } from '../../cli/commands/answer';
import { runAsk } from '../../cli/commands/ask';
import { runDone } from '../../cli/commands/done';
import { runEscalate } from '../../cli/commands/escalate';
import { runUnblock } from '../../cli/commands/unblock';
import { openTask } from '../../cli/management';
import type { FactoryEvent } from '../../engine/events';
import { reduce } from '../../engine/reduce';
import type { AttemptState } from '../../engine/state';
import { worktreeDir } from '../../paths';
import { agentName } from '../names';
import { reconcile } from '../reconcile';
import { tick } from '../run';
import { closePreviousOperatorTabs } from '../operator';
import {
  definitions,
  harness,
  scratchRoot,
  todoText,
  type Harness,
} from './fixtures';

const TASK = 'hello';
const feature = (() => {
  const workflow = definitions.workflows.get('feature');
  if (workflow === undefined) throw new Error('feature workflow missing');
  return workflow;
})();

/** A task past setup with a running `build` attempt; its worktree exists on disk. */
const runningBuild = (): Harness => {
  const root = scratchRoot({ 'hello.md': todoText('todo') });
  const h = harness(root);
  mkdirSync(worktreeDir(root, TASK), { recursive: true });
  h.store.createTask({
    taskId: TASK,
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  append(h, {
    type: 'task_created',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  append(h, { type: 'setup_finished', ok: true, log: 'l' });
  startBuild(h);
  return h;
};

const append = (h: Harness, event: FactoryEvent): void => {
  h.store.append(TASK, event);
};

const startBuild = (h: Harness): void => {
  append(h, {
    type: 'attempt_started',
    attemptId: 'build-1',
    stepId: 'build',
    n: 1,
    snapshotRef: 'refs/software-factory/hello/build/build-1',
    artifacts: {},
  });
  append(h, { type: 'agent_ready', attemptId: 'build-1', pane: 'p', tab: 't' });
};

const state = (h: Harness) => {
  return reduce(feature, h.store.events(TASK));
};

const operatorAttempt = (h: Harness): AttemptState => {
  const operator = state(h).operator;
  if (operator === undefined) throw new Error('the operator never started');
  return operator;
};

const ticks = async (h: Harness, count: number): Promise<void> => {
  for (let i = 0; i < count; i++) await tick(h.ports, () => undefined);
};

/** The operator's shell: the env its pane gets. */
const operatorEnv = (h: Harness): Record<string, string> => {
  return {
    FACTORY_ROOT: h.root,
    FACTORY_TASK: TASK,
    FACTORY_ATTEMPT: operatorAttempt(h).attemptId,
  };
};

const operatorDoes = (h: Harness, command: 'done' | 'none' = 'done'): void => {
  if (command === 'none') return;
  const operator = operatorAttempt(h);
  for (const path of Object.values(operator.artifacts)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${basename(path)} written by the fake operator\n`);
  }
  const caller = resolveCaller(operatorEnv(h), h.store, definitions);
  const outcome = runDone(caller);
  if (!outcome.ok)
    throw new Error(`done refused: ${outcome.missing.join(',')}`);
};

const handle = (h: Harness) => {
  return openTask(h.store, TASK, operatorEnv(h), definitions.workflows);
};

const prompts = (h: Harness): string[] => {
  return h.herdr.calls.flatMap((call) =>
    call.method === 'prompt' ? [String(call.args[1])] : [],
  );
};

const eventTypes = (h: Harness): string[] => {
  return h.store.events(TASK).map((stored) => stored.event.type);
};

describe('operator incident triage (fake ports)', () => {
  it('starts in its own tab for a question addressed to it, then delivers the answer to the waiting agent', async () => {
    const h = runningBuild();
    const worker = resolveCaller(
      { FACTORY_ROOT: h.root, FACTORY_TASK: TASK, FACTORY_ATTEMPT: 'build-1' },
      h.store,
      definitions,
    );
    runAsk(worker, 'operator', 'which database?');

    await ticks(h, 1);

    const tab = h.herdr.calls.find(
      (call) =>
        call.method === 'createTab' &&
        (call.args[0] as { label: string }).label === 'operator#1',
    );
    expect(tab?.args[0]).toMatchObject({
      label: 'operator#1',
      env: {
        FACTORY_TASK: TASK,
        FACTORY_ATTEMPT: operatorAttempt(h).attemptId,
      },
    });
    const promptPath = join(
      dirname(Object.values(operatorAttempt(h).artifacts)[0] ?? ''),
      'prompt.md',
    );
    const prompt = readFileSync(promptPath, 'utf8');
    expect(prompt).toContain('which database?');
    expect(prompt).toContain('sf answer');
    expect(prompt).not.toContain('sf ask');
    expect(state(h).operator?.status).toBe('running');

    runAnswer(handle(h), 'postgres');
    operatorDoes(h);
    await ticks(h, 3);

    expect(prompts(h)).toContain(
      'The question "which database?" was answered: postgres\n\nContinue with your task.\n',
    );
    expect(eventTypes(h)).toContain('prompt_delivered');
    expect(state(h).pendingPrompts).toEqual([]);
    expect(state(h).block).toBeUndefined();
  });

  it('never starts for a question addressed to a human', async () => {
    const h = runningBuild();
    const worker = resolveCaller(
      { FACTORY_ROOT: h.root, FACTORY_TASK: TASK, FACTORY_ATTEMPT: 'build-1' },
      h.store,
      definitions,
    );
    runAsk(worker, 'human', 'may I delete the table?');

    await ticks(h, 3);

    expect(state(h).operator).toBeUndefined();
    expect(
      h.herdr.calls.filter(
        (call) =>
          call.method === 'createTab' &&
          (call.args[0] as { label: string }).label !== 'cli',
      ),
    ).toEqual([]);
    expect(state(h).status).toBe('waiting');
  });

  it('reads the blocked pane when a runner prompt blocks the agent, then types the nudge', async () => {
    const h = runningBuild();
    h.herdr.observations = ['blocked'];
    h.herdr.paneText = 'Allow this tool? [y/N]';

    await ticks(h, 2);
    expect(state(h).block?.reason).toBe('runner_prompt');
    expect(operatorAttempt(h).status).toBe('running');
    const reads = h.herdr.calls.filter((call) => call.method === 'read');
    expect(reads.at(-1)?.args).toEqual([agentName(TASK, 'build', 1), 50]);
    const prompt = readFileSync(
      join(
        dirname(Object.values(operatorAttempt(h).artifacts)[0] ?? ''),
        'prompt.md',
      ),
      'utf8',
    );
    expect(prompt).toContain('Allow this tool? [y/N]');

    runUnblock(handle(h), 'y');
    operatorDoes(h);
    await ticks(h, 3);

    expect(prompts(h)).toContain('y');
    expect(state(h).block).toBeUndefined();
    expect(state(h).pendingPrompts).toEqual([]);
  });

  it('goes to a human after the operator escalates, publishing the work once and starting no second operator', async () => {
    const h = runningBuild();
    h.git.changes = true;
    append(h, { type: 'blocked', reason: 'infra', detail: 'herdr hiccup' });

    await ticks(h, 1);
    expect(h.deliverer.blockedCalls).toEqual([]);

    runEscalate(handle(h), 'the registry is down');
    operatorDoes(h);
    await ticks(h, 6);

    expect(h.deliverer.blockedCalls).toEqual([
      { taskId: TASK, reason: 'infra' },
    ]);
    expect(
      eventTypes(h).filter((type) => type === 'attempt_started' && true).length,
    ).toBe(2);
    const operators = h.store
      .events(TASK)
      .filter(
        (stored) =>
          stored.event.type === 'attempt_started' &&
          stored.event.stepId === 'operator',
      );
    expect(operators).toHaveLength(1);
    expect(state(h).block?.detail).toBe('the registry is down');
    expect(state(h).status).toBe('parked');
  });

  it('escalates by itself when the operator ends without resolving anything', async () => {
    const h = runningBuild();
    h.git.changes = true;
    append(h, { type: 'blocked', reason: 'infra', detail: 'x' });

    await ticks(h, 1);
    operatorDoes(h);
    await ticks(h, 6);

    expect(state(h).block?.detail).toContain('without resolving');
    expect(h.deliverer.blockedCalls).toHaveLength(1);
    expect(state(h).operatorRan).toBe(true);
  });

  it('does not blame the operator for a worktree change while another agent works', async () => {
    const h = runningBuild();
    h.git.changes = true;
    append(h, { type: 'blocked', reason: 'infra', detail: 'x' });

    await ticks(h, 1);
    h.git.differs = true;
    runEscalate(handle(h), 'could not fix');
    operatorDoes(h);
    await ticks(h, 6);

    expect(state(h).block).toEqual({
      reason: 'infra',
      detail: 'could not fix',
    });
    expect(JSON.stringify(h.store.events(TASK))).not.toContain(
      'operator changed worktree',
    );
    expect(
      h.store
        .events(TASK)
        .filter((stored) => stored.event.type === 'operator_checked')
        .map((stored) => stored.event),
    ).toEqual([expect.objectContaining({ changed: false })]);
  });

  it('blocks as infra without a second operator when the operator changed the worktree', async () => {
    const h = runningBuild();
    h.git.changes = true;
    append(h, { type: 'blocked', reason: 'infra', detail: 'x' });
    append(h, { type: 'completed', attemptId: 'build-1' });

    await ticks(h, 1);
    h.git.differs = true;
    runEscalate(handle(h), 'could not fix');
    operatorDoes(h);
    await ticks(h, 6);

    expect(state(h).block).toEqual({
      reason: 'infra',
      detail: 'operator changed worktree',
    });
    expect(h.git.calls.filter((call) => call.method === 'restore')).toEqual([]);
    expect(
      h.store
        .events(TASK)
        .filter(
          (stored) =>
            stored.event.type === 'attempt_started' &&
            stored.event.stepId === 'operator',
        ),
    ).toHaveLength(1);
    expect(h.deliverer.blockedCalls).toHaveLength(1);
  });

  it('parks the task for a human when the operator pane never starts', async () => {
    const h = runningBuild();
    append(h, { type: 'blocked', reason: 'infra', detail: 'x' });
    h.herdr.startAgent = async () => {
      throw new Error('herdr refused the agent');
    };

    await ticks(h, 6);

    expect(operatorAttempt(h).outcome).toBe('start_failed');
    expect(state(h).status).toBe('parked');
    expect(
      h.store
        .events(TASK)
        .filter((stored) => stored.event.type === 'escalated'),
    ).toHaveLength(1);
  });

  it('does not publish a blocked PR before the operator had its turn', async () => {
    const h = runningBuild();
    h.git.changes = true;
    append(h, { type: 'completed', attemptId: 'build-1' });
    for (const round of [1, 2, 3, 4]) {
      if (round > 1) {
        append(h, {
          type: 'attempt_started',
          attemptId: `build-${round}`,
          stepId: 'build',
          n: round,
          feedbackFrom: `gate-${round - 1}`,
          snapshotRef: `refs/software-factory/hello/build/build-${round}`,
          artifacts: {},
        });
        append(h, { type: 'completed', attemptId: `build-${round}` });
      }
      append(h, {
        type: 'attempt_started',
        attemptId: `gate-${round}`,
        stepId: 'quality-gate',
        n: round,
        snapshotRef: `refs/software-factory/hello/quality-gate/gate-${round}`,
        artifacts: {},
      });
      append(h, {
        type: 'gate_finished',
        attemptId: `gate-${round}`,
        passed: false,
        failures: [],
      });
    }

    await ticks(h, 1);
    expect(state(h).block?.reason).toBe('retries_exhausted');
    expect(h.deliverer.blockedCalls).toEqual([]);

    await ticks(h, 1);
    expect(operatorAttempt(h).status).toBe('running');

    runUnblock(handle(h), undefined);
    operatorDoes(h);
    await ticks(h, 3);
    expect(h.deliverer.blockedCalls).toEqual([]);
    expect(state(h).current?.stepId).toBe('build');
    expect(state(h).current?.n).toBe(5);
  });

  it('delivers nothing to an agent that is gone', async () => {
    const h = runningBuild();
    append(h, { type: 'blocked', reason: 'runner_prompt', detail: 'x' });
    append(h, { type: 'unblocked', by: 'human', nudge: 'y' });
    append(h, {
      type: 'attempt_failed',
      attemptId: 'build-1',
      reason: 'crashed',
      detail: 'x',
    });

    await ticks(h, 1);

    expect(prompts(h)).toEqual([]);
  });
});

describe('restart reconciliation of the operator', () => {
  it('records a crashed operator whose pane vanished', async () => {
    const h = runningBuild();
    append(h, { type: 'blocked', reason: 'infra', detail: 'x' });
    append(h, {
      type: 'attempt_started',
      attemptId: 'op-1',
      stepId: 'operator',
      n: 1,
      snapshotRef: 'refs/software-factory/hello/operator/op-1',
      artifacts: {},
    });
    append(h, { type: 'agent_ready', attemptId: 'op-1', pane: 'p', tab: 't' });
    h.store.setTaskStatus(TASK, 'waiting');

    await reconcile(h.ports);

    expect(h.store.events(TASK).at(-1)?.event).toMatchObject({
      type: 'attempt_failed',
      attemptId: 'op-1',
      reason: 'crashed',
    });
  });

  it('re-adopts an operator whose pane is alive', async () => {
    const h = runningBuild();
    append(h, { type: 'blocked', reason: 'infra', detail: 'x' });
    append(h, {
      type: 'attempt_started',
      attemptId: 'op-1',
      stepId: 'operator',
      n: 1,
      snapshotRef: 'refs/software-factory/hello/operator/op-1',
      artifacts: {},
    });
    append(h, { type: 'agent_ready', attemptId: 'op-1', pane: 'p', tab: 't' });
    h.store.setTaskStatus(TASK, 'waiting');
    await h.herdr.startAgent({
      name: agentName(TASK, 'operator', 1),
      kind: 'claude',
      paneId: 'p',
      args: [],
      timeoutMs: 1,
    });

    await reconcile(h.ports);

    expect(state(h).operator?.status).toBe('running');
  });
});

describe('one operator pane per task', () => {
  it('closes the tabs of earlier operator attempts before a new one starts', async () => {
    const h = runningBuild();
    for (const n of [1, 2]) {
      append(h, {
        type: 'attempt_started',
        attemptId: `operator-${n}`,
        stepId: 'operator',
        n,
        snapshotRef: `snap-operator-${n}`,
        artifacts: {},
      });
      append(h, {
        type: 'agent_ready',
        attemptId: `operator-${n}`,
        pane: `pane-operator-${n}`,
        tab: `tab-operator-${n}`,
      });
    }

    await closePreviousOperatorTabs(h.ports, TASK);

    const closed = h.herdr.calls
      .filter((call) => call.method === 'closeTab')
      .map((call) => call.args[0]);
    expect(closed.sort()).toEqual(['tab-operator-1', 'tab-operator-2']);
  });
});
