import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadDefinitions } from '../../definitions/load';
import type { Definitions } from '../../definitions/types';
import { reduce } from '../../engine/reduce';
import { PACKAGE_ROOT } from '../../paths';
import { FakeClock } from '../../testing/fake-clock';
import { FakeStore } from '../../testing/fake-store';
import { boardRows, renderBoard } from '../board';
import { CallerError, resolveCaller, type Caller } from '../caller';
import { runAnswer } from '../commands/answer';
import { runAsk } from '../commands/ask';
import { runEscalate } from '../commands/escalate';
import { runTell } from '../commands/tell';
import { runUnblock } from '../commands/unblock';
import { openTask, type TaskHandle } from '../management';
import { plainPaint } from '../../paint';

const loaded = loadDefinitions(PACKAGE_ROOT);
if (!loaded.ok) throw new Error('shipped definitions must load');
const definitions: Definitions = loaded.value;

let root: string;
let store: FakeStore;

const TASK = 'task-1';

const env = (attemptId: string): Record<string, string> => {
  return { FACTORY_ROOT: root, FACTORY_TASK: TASK, FACTORY_ATTEMPT: attemptId };
};

const startAttempt = (attemptId: string, stepId: string): void => {
  store.append(TASK, {
    type: 'attempt_started',
    attemptId,
    stepId,
    n: 1,
    snapshotRef: `refs/software-factory/${TASK}/${stepId}/${attemptId}`,
    artifacts: {},
  });
  store.append(TASK, { type: 'agent_ready', attemptId, pane: 'p', tab: 't' });
};

const caller = (attemptId: string): Caller => {
  return resolveCaller(env(attemptId), store, definitions);
};

const task = (shellEnv: Record<string, string> = {}): TaskHandle => {
  return openTask(store, TASK, shellEnv, definitions.workflows);
};

const lastEvent = (): unknown => {
  return store.events(TASK).at(-1)?.event;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sf-comm-'));
  store = new FakeStore(new FakeClock(0));
  store.createTask({
    taskId: TASK,
    workflow: 'feature',
    todoPath: 'todos/x.md',
    branch: 'factory/task-1',
  });
  store.append(TASK, {
    type: 'task_created',
    workflow: 'feature',
    todoPath: 'todos/x.md',
    branch: 'factory/task-1',
  });
  store.append(TASK, { type: 'setup_finished', ok: true, log: 'setup.log' });
});

describe('software-factory ask', () => {
  it('records the question and parks the attempt', () => {
    startAttempt('att-1', 'build');
    const { questionId, to } = runAsk(caller('att-1'), 'human', ' which db? ');

    expect(to).toBe('human');
    expect(lastEvent()).toEqual({
      type: 'question_asked',
      attemptId: 'att-1',
      questionId,
      to: 'human',
      text: 'which db?',
    });
    expect(task().state.openQuestion?.text).toBe('which db?');
    expect(task().state.status).toBe('waiting');
  });

  it('refuses an empty question', () => {
    startAttempt('att-1', 'build');
    expect(() => runAsk(caller('att-1'), 'human', '   ')).toThrow(
      'must not be empty',
    );
  });

  it('refuses a target other than operator or human', () => {
    startAttempt('att-1', 'build');
    expect(() => runAsk(caller('att-1'), 'bob', 'hi')).toThrow(CallerError);
  });

  it('refuses a second question while one is open', () => {
    startAttempt('att-1', 'build');
    runAsk(caller('att-1'), 'human', 'first');
    expect(() => runAsk(caller('att-1'), 'human', 'second')).toThrow(
      'still open',
    );
  });

  it('refuses to ask the operator when the workflow declares none', () => {
    startAttempt('att-1', 'build');
    const bare = caller('att-1');
    const withoutOperator = { ...bare.workflow };
    delete withoutOperator.operator;
    expect(() =>
      runAsk({ ...bare, workflow: withoutOperator }, 'operator', 'hi'),
    ).toThrow('has no operator');
  });

  it('refuses a call from the operator pane', () => {
    startAttempt('att-1', 'build');
    store.append(TASK, { type: 'blocked', reason: 'infra', detail: 'x' });
    startAttempt('op-1', 'operator');
    const operator = caller('op-1');
    expect(operator.isOperator).toBe(true);
    expect(() => runAsk(operator, 'human', 'hi')).toThrow('operator cannot');
  });

  it('refuses outside a running attempt', () => {
    startAttempt('att-1', 'build');
    store.append(TASK, { type: 'completed', attemptId: 'att-1' });
    expect(() => caller('att-1')).toThrow('is not running');
  });
});

describe('software-factory tell', () => {
  it('records a note without blocking the attempt', () => {
    startAttempt('att-1', 'plan');
    runTell(caller('att-1'), 'build', 'use the cache');

    expect(lastEvent()).toEqual({
      type: 'note',
      attemptId: 'att-1',
      to: 'build',
      text: 'use the cache',
    });
    const state = task().state;
    expect(state.notes).toHaveLength(1);
    expect(state.openQuestion).toBeUndefined();
    expect(state.status).toBe('running');
  });

  it('accepts a human as the target', () => {
    startAttempt('att-1', 'plan');
    runTell(caller('att-1'), 'human', 'FYI');
    expect(task().state.notes[0]?.toStep).toBe('human');
  });

  it('refuses an unknown target and names the steps', () => {
    startAttempt('att-1', 'plan');
    expect(() => runTell(caller('att-1'), 'nowhere', 'x')).toThrow(
      'plan, plan-review, build',
    );
  });

  it('refuses an empty note', () => {
    startAttempt('att-1', 'plan');
    expect(() => runTell(caller('att-1'), 'build', ' ')).toThrow(
      'must not be empty',
    );
  });
});

describe('software-factory answer', () => {
  it('answers the open question from any shell', () => {
    startAttempt('att-1', 'build');
    const { questionId } = runAsk(caller('att-1'), 'operator', 'which db?');

    runAnswer(task(), 'postgres');

    expect(lastEvent()).toEqual({
      type: 'answered',
      questionId,
      by: 'human',
      text: 'postgres',
    });
    expect(task().state.openQuestion).toBeUndefined();
  });

  it('refuses when no question is open', () => {
    startAttempt('att-1', 'build');
    expect(() => runAnswer(task(), 'x')).toThrow('no open question');
  });

  it('refuses an empty answer', () => {
    startAttempt('att-1', 'build');
    runAsk(caller('att-1'), 'human', 'q');
    expect(() => runAnswer(task(), ' ')).toThrow('must not be empty');
  });

  it('lets the operator answer a question addressed to it', () => {
    startAttempt('att-1', 'build');
    runAsk(caller('att-1'), 'operator', 'q');
    startAttempt('op-1', 'operator');

    runAnswer(task(env('op-1')), 'a');

    expect(lastEvent()).toMatchObject({ type: 'answered', by: 'operator' });
  });

  it('refuses the operator an answer to a question for a human', () => {
    startAttempt('att-1', 'build');
    runAsk(caller('att-1'), 'human', 'q');
    startAttempt('op-1', 'operator');

    expect(() => runAnswer(task(env('op-1')), 'a')).toThrow('asked to a human');
  });
});

describe('software-factory escalate', () => {
  it('hands a blocked task to a human with the summary', () => {
    store.append(TASK, { type: 'blocked', reason: 'infra', detail: 'x' });
    runEscalate(task(), 'credentials missing');
    expect(lastEvent()).toEqual({
      type: 'escalated',
      text: 'credentials missing',
    });
  });

  it('refuses a task that is neither blocked nor waiting', () => {
    expect(() => runEscalate(task(), 'x')).toThrow('neither blocked');
  });

  it('refuses an empty reason', () => {
    store.append(TASK, { type: 'blocked', reason: 'infra', detail: 'x' });
    expect(() => runEscalate(task(), '')).toThrow('must not be empty');
  });
});

describe('software-factory unblock', () => {
  const exhaust = (): void => {
    startAttempt('quality-gate-1', 'quality-gate');
    store.append(TASK, {
      type: 'gate_finished',
      attemptId: 'quality-gate-1',
      passed: false,
      failures: [],
    });
    store.append(TASK, {
      type: 'blocked',
      reason: 'retries_exhausted',
      detail: 'x',
    });
  };

  it('grants one extra retry for an exhausted budget', () => {
    exhaust();
    runUnblock(task(), undefined);
    expect(lastEvent()).toEqual({
      type: 'unblocked',
      by: 'human',
      extraRetry: true,
    });
    expect(task().state.extraRetry).toEqual({ stepId: 'quality-gate' });
  });

  it('refuses a second extra retry in the task lifetime', () => {
    exhaust();
    runUnblock(task(), undefined);
    store.append(TASK, {
      type: 'blocked',
      reason: 'retries_exhausted',
      detail: 'again',
    });
    expect(() => runUnblock(task(), undefined)).toThrow('already granted');
  });

  it('sends a nudge for a runner prompt', () => {
    startAttempt('att-1', 'build');
    store.append(TASK, {
      type: 'blocked',
      reason: 'runner_prompt',
      detail: 'x',
    });
    runUnblock(task(), ' y ');
    expect(lastEvent()).toEqual({
      type: 'unblocked',
      by: 'human',
      nudge: 'y',
    });
    expect(task().state.pendingPrompts).toEqual([
      { attemptId: 'att-1', kind: 'nudge', text: 'y' },
    ]);
  });

  it('presses a menu option then Enter for a runner prompt', () => {
    startAttempt('att-1', 'build');
    store.append(TASK, {
      type: 'blocked',
      reason: 'runner_prompt',
      detail: 'x',
    });
    runUnblock(task(), undefined, '1');
    expect(lastEvent()).toEqual({
      type: 'unblocked',
      by: 'human',
      keys: ['1', 'Enter'],
    });
    expect(task().state.pendingPrompts).toEqual([
      { attemptId: 'att-1', kind: 'keys', text: '', keys: ['1', 'Enter'] },
    ]);
  });

  it('presses a letter option then Enter for a runner prompt', () => {
    startAttempt('att-1', 'build');
    store.append(TASK, {
      type: 'blocked',
      reason: 'runner_prompt',
      detail: 'Proceed (y)',
    });
    runUnblock(task(), undefined, 'y');
    expect(lastEvent()).toEqual({
      type: 'unblocked',
      by: 'human',
      keys: ['y', 'Enter'],
    });
    expect(task().state.pendingPrompts).toEqual([
      { attemptId: 'att-1', kind: 'keys', text: '', keys: ['y', 'Enter'] },
    ]);
  });

  it('refuses a menu number outside 1-9 and choose together with nudge', () => {
    startAttempt('att-1', 'build');
    store.append(TASK, {
      type: 'blocked',
      reason: 'runner_prompt',
      detail: 'x',
    });
    expect(() => runUnblock(task(), undefined, '0')).toThrow('1 to 9');
    expect(() => runUnblock(task(), 'y', '1')).toThrow('not both');
  });

  it('requires nudge text for a runner prompt', () => {
    startAttempt('att-1', 'build');
    store.append(TASK, {
      type: 'blocked',
      reason: 'runner_prompt',
      detail: 'x',
    });
    expect(() => runUnblock(task(), undefined)).toThrow('--nudge');
  });

  it.each(['infra', 'setup_failed', 'delivery_failed', 'no_retry'] as const)(
    'refuses a %s block and points to answer or escalate',
    (reason) => {
      store.append(TASK, { type: 'blocked', reason, detail: 'x' });
      expect(() => runUnblock(task(), 'y')).toThrow('sf escalate');
    },
  );

  it('unblocks a final infra block where the operator already ran', () => {
    store.append(TASK, {
      type: 'attempt_started',
      attemptId: 'op-1',
      stepId: 'operator',
      n: 1,
      snapshotRef: 'refs/op-1',
      artifacts: {},
    });
    store.append(TASK, {
      type: 'attempt_failed',
      attemptId: 'op-1',
      reason: 'crashed',
      detail: 'crashed',
    });
    store.append(TASK, {
      type: 'operator_checked',
      attemptId: 'op-1',
      changed: false,
    });
    store.append(TASK, {
      type: 'blocked',
      reason: 'infra',
      detail: 'network down',
    });
    const message = runUnblock(task(), undefined);
    expect(message).toContain(
      `unblocked task ${TASK}; it is queued until the line is free`,
    );
    expect(store.tasks()[0]?.status).toBe('queued');
  });

  it('refuses a task that is not blocked', () => {
    expect(() => runUnblock(task(), 'y')).toThrow('not blocked');
  });

  it('leaves the state untouched after a refusal', () => {
    store.append(TASK, { type: 'blocked', reason: 'infra', detail: 'x' });
    const before = reduce(
      definitions.workflows.get('feature')!,
      store.events(TASK),
    ).block;
    expect(() => runUnblock(task(), 'y')).toThrow();
    expect(task().state.block).toEqual(before);
  });
});

describe('the board', () => {
  it('shows an open question with a copy-pasteable answer command', () => {
    startAttempt('att-1', 'build');
    runAsk(caller('att-1'), 'human', 'which db?');
    const text = renderBoard(boardRows(store, definitions, 10_000), plainPaint);
    expect(text).toContain('question to human: which db?');
    expect(text).toContain('sf answer task-1 "<your answer>"');
  });
});
