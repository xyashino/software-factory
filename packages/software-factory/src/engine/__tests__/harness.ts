import { fileURLToPath } from 'node:url';
import { loadDefinitions } from '../../definitions/load';
import type { Workflow } from '../../definitions/types';
import type { SupervisorAction } from '../actions';
import type {
  BlockReason,
  FactoryEvent,
  GateFailure,
  TimedEvent,
} from '../events';
import { nextAction } from '../next-action';
import { reduce } from '../reduce';
import type { TaskState } from '../state';

const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Loads a shipped workflow (`feature`, `review`) from disk, failing the test on any problem. */
export const loadWorkflow = (name: string): Workflow => {
  const loaded = loadDefinitions(PACKAGE_ROOT);
  if (!loaded.ok) {
    throw new Error(`definitions do not load: ${JSON.stringify(loaded.error)}`);
  }
  const workflow = loaded.value.workflows.get(name);
  if (workflow === undefined) {
    throw new Error(`no workflow named "${name}"`);
  }
  return workflow;
};

export const operatorIdOf = (n: number): string => {
  return `operator-${n}`;
};

export const attemptIdOf = (stepId: string, n: number): string => {
  return `${stepId}-${n}`;
};

/** Stamps events with increasing times, one second apart. */
export const stamp = (events: readonly FactoryEvent[]): TimedEvent[] => {
  return events.map((event, index) => ({ at: (index + 1) * 1000, event }));
};

/** Folds the events and asks the engine what to do next. */
export const run = (
  workflow: Workflow,
  events: readonly FactoryEvent[],
): { state: TaskState; action: SupervisorAction } => {
  const state = reduce(workflow, stamp(events));
  return { state, action: nextAction(workflow, state) };
};

/** Event builders. Each returns plain data; time comes from `stamp`. */
export const ev = {
  taskCreated(): FactoryEvent {
    return {
      type: 'task_created',
      workflow: 'feature',
      todoPath: 'todos/task.md',
      branch: 'feat/task',
    };
  },

  setupFinished(ok = true): FactoryEvent {
    return { type: 'setup_finished', ok, log: '' };
  },

  attemptStarted(
    stepId: string,
    n: number,
    extra: {
      restartOf?: string;
      feedbackFrom?: string;
      snapshotRef?: string;
    } = {},
  ): FactoryEvent {
    const attemptId = attemptIdOf(stepId, n);
    return {
      type: 'attempt_started',
      attemptId,
      stepId,
      n,
      restartOf: extra.restartOf,
      feedbackFrom: extra.feedbackFrom,
      snapshotRef: extra.snapshotRef ?? `snap-${attemptId}`,
      artifacts: {},
    };
  },

  agentReady(attemptId: string): FactoryEvent {
    return { type: 'agent_ready', attemptId, pane: 'pane', tab: 'tab' };
  },

  completed(attemptId: string): FactoryEvent {
    return { type: 'completed', attemptId };
  },

  verdict(
    attemptId: string,
    pass: boolean,
    feedbackPath?: string,
  ): FactoryEvent {
    return { type: 'verdict', attemptId, pass, feedbackPath };
  },

  gatePassed(attemptId: string): FactoryEvent {
    return { type: 'gate_finished', attemptId, passed: true, failures: [] };
  },

  gateFailed(attemptId: string, tail = 'FAIL'): FactoryEvent {
    return {
      type: 'gate_finished',
      attemptId,
      passed: false,
      failures: [failure(tail)],
    };
  },

  attemptFailed(
    attemptId: string,
    reason: 'timed_out' | 'crashed' | 'stalled' | 'start_failed',
  ): FactoryEvent {
    return { type: 'attempt_failed', attemptId, reason, detail: reason };
  },

  reminder(attemptId: string, kind: 'idle' | 'silent'): FactoryEvent {
    return { type: 'reminder_sent', attemptId, kind };
  },

  questionAsked(
    attemptId: string,
    questionId: string,
    to: 'operator' | 'human' = 'operator',
  ): FactoryEvent {
    return { type: 'question_asked', attemptId, questionId, to, text: '?' };
  },

  answered(questionId: string, by = 'operator'): FactoryEvent {
    return { type: 'answered', questionId, by, text: 'yes' };
  },

  note(attemptId: string, to: string, text = 'remember'): FactoryEvent {
    return { type: 'note', attemptId, to, text };
  },

  /** The operator attempt's id for its nth run. */
  operatorStarted(n = 1): FactoryEvent {
    return {
      type: 'attempt_started',
      attemptId: operatorIdOf(n),
      stepId: 'operator',
      n,
      snapshotRef: `snap-operator-${n}`,
      artifacts: {},
    };
  },

  operatorChecked(n = 1, changed = false): FactoryEvent {
    return { type: 'operator_checked', attemptId: operatorIdOf(n), changed };
  },

  escalated(text = 'needs a human'): FactoryEvent {
    return { type: 'escalated', text };
  },

  promptDelivered(
    attemptId: string,
    kind: 'answer' | 'nudge' = 'answer',
  ): FactoryEvent {
    return { type: 'prompt_delivered', attemptId, kind };
  },

  blocked(reason: BlockReason, detail = ''): FactoryEvent {
    return { type: 'blocked', reason, detail };
  },

  unblocked(
    extra: { nudge?: string; extraRetry?: boolean } = {},
  ): FactoryEvent {
    return { type: 'unblocked', by: 'human', ...extra };
  },

  deliveryStarted(to: 'new-pr' | 'blocked-pr' = 'new-pr'): FactoryEvent {
    return { type: 'delivery_started', to };
  },

  delivered(prUrl = 'https://example.test/pr/1'): FactoryEvent {
    return { type: 'delivered', prUrl };
  },
};

export const failure = (tail: string): GateFailure => {
  return {
    command: 'pnpm test',
    exitCode: 1,
    timedOut: false,
    tail,
    logPath: '/evidence/gate.log',
  };
};

const unresolved = (
  workflow: Workflow,
  events: readonly FactoryEvent[],
): boolean => {
  const { state } = run(workflow, events);
  return (
    (state.block !== undefined || state.openQuestion !== undefined) &&
    state.escalation === undefined
  );
};

/** What an oracle is asked about each attempt the supervisor starts. */
export interface AttemptRun {
  attemptId: string;
  stepId: string;
  n: number;
  restartOf: string | undefined;
  feedbackFrom: string | undefined;
}

/** Returns the events that finish the attempt: a verdict, a gate result, a crash, and so on. */
export type Oracle = (attempt: AttemptRun) => FactoryEvent[];

/** What the operator does when the line blocks: the events its commands and its end write. */
export type OperatorOracle = (
  action: Extract<SupervisorAction, { type: 'start_operator' }>,
  n: number,
) => FactoryEvent[];

export interface Simulation {
  operatorRuns: number;
  events: FactoryEvent[];
  actions: SupervisorAction[];
  attempts: AttemptRun[];
  ending: { type: 'delivered' } | { type: 'blocked'; reason: BlockReason };
}

/**
 * Drives the engine end to end: each action is performed by writing the events
 * a real supervisor would write, and the oracle decides how each attempt ends.
 * No I/O: the whole workflow runs in memory.
 */
export const simulate = (
  workflow: Workflow,
  oracle: Oracle,
  maxActions = 300,
  operatorOracle?: OperatorOracle,
): Simulation => {
  const events: FactoryEvent[] = [ev.taskCreated()];
  const actions: SupervisorAction[] = [];
  const attempts: AttemptRun[] = [];
  let operatorRuns = 0;
  const result = (ending: Simulation['ending']): Simulation => ({
    events,
    actions,
    attempts,
    operatorRuns,
    ending,
  });

  for (let step = 0; step < maxActions; step += 1) {
    const { action } = run(workflow, events);
    actions.push(action);

    switch (action.type) {
      case 'setup':
        events.push(ev.setupFinished(true));
        break;
      case 'start_attempt': {
        const attempt: AttemptRun = {
          attemptId: attemptIdOf(action.stepId, action.n),
          stepId: action.stepId,
          n: action.n,
          restartOf: action.restartOf,
          feedbackFrom: action.feedbackFrom,
        };
        attempts.push(attempt);
        events.push(
          ev.attemptStarted(action.stepId, action.n, {
            restartOf: action.restartOf,
            feedbackFrom: action.feedbackFrom,
            snapshotRef: action.restoreSnapshot,
          }),
        );
        events.push(...oracle(attempt));
        break;
      }
      case 'deliver':
        events.push(ev.deliveryStarted(action.to), ev.delivered());
        return result({ type: 'delivered' });
      case 'block':
        events.push(ev.blocked(action.reason, action.detail));
        // The operator gets its turn before the block is final.
        if (run(workflow, events).action.type === 'start_operator') break;
        return result({ type: 'blocked', reason: action.reason });
      case 'start_operator': {
        operatorRuns += 1;
        events.push(
          ev.operatorStarted(operatorRuns),
          ev.agentReady(operatorIdOf(operatorRuns)),
          ...(operatorOracle?.(action, operatorRuns) ?? []),
          ev.completed(operatorIdOf(operatorRuns)),
          ev.operatorChecked(operatorRuns),
        );
        // Like the supervisor: an incident the operator left open goes to a human.
        if (unresolved(workflow, events)) events.push(ev.escalated());
        break;
      }
      case 'watch':
      case 'deliver_prompt':
      case 'idle':
        throw new Error(`simulation stuck on ${action.type}`);
    }
  }
  throw new Error('simulation did not finish within the action budget');
};
