import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../definitions/types';
import type { FactoryEvent } from '../events';
import { nextAction } from '../next-action';
import { reduce } from '../reduce';
import {
  attemptIdOf,
  ev,
  loadWorkflow,
  run,
  simulate,
  stamp,
  type AttemptRun,
  type Oracle,
} from './harness';

type Outcome = 'pass' | 'fail' | 'crash';

interface Script {
  /** outcomes per step, consumed attempt by attempt; `pass` once exhausted */
  outcomes?: Record<string, Outcome[]>;
  /** step ids that are judges: they answer with a verdict, not `completed` */
  judges: string[];
  /** every attempt of every step gets this outcome when no script applies */
  fallback?: Outcome;
}

/** An oracle that plays out a fixed sequence of outcomes per step. */
const scripted = (workflow: Workflow, script: Script): Oracle => {
  const remaining = new Map<string, Outcome[]>(
    Object.entries(script.outcomes ?? {}).map(([stepId, list]) => [
      stepId,
      [...list],
    ]),
  );
  return (attempt) => {
    const queue = remaining.get(attempt.stepId) ?? [];
    const outcome = queue.shift() ?? script.fallback ?? 'pass';
    return finish(workflow, script, attempt, outcome);
  };
};

const finish = (
  workflow: Workflow,
  script: Script,
  attempt: AttemptRun,
  outcome: Outcome,
): FactoryEvent[] => {
  if (outcome === 'crash')
    return [ev.attemptFailed(attempt.attemptId, 'crashed')];
  const step = workflow.steps.find(
    (candidate) => candidate.id === attempt.stepId,
  );
  if (step?.type === 'commands') {
    return [
      outcome === 'pass'
        ? ev.gatePassed(attempt.attemptId)
        : ev.gateFailed(attempt.attemptId),
    ];
  }
  if (script.judges.includes(attempt.stepId)) {
    return [
      ev.verdict(
        attempt.attemptId,
        outcome === 'pass',
        `/evidence/${attempt.attemptId}.md`,
      ),
    ];
  }
  return [ev.completed(attempt.attemptId)];
};

/** The sequence of step ids the supervisor started, in order. */
const stepsRun = (attempts: readonly AttemptRun[]): string[] => {
  return attempts.map((attempt) => attempt.stepId);
};

const feature = loadWorkflow('feature');
const featureJudges = ['plan-review', 'audit'];

describe('feature workflow, simulated in memory', () => {
  it('delivers after every step passes once, in order', () => {
    const result = simulate(
      feature,
      scripted(feature, { judges: featureJudges }),
    );

    expect(result.ending).toEqual({ type: 'delivered' });
    expect(stepsRun(result.attempts)).toEqual([
      'plan',
      'plan-review',
      'build',
      'quality-gate',
      'audit',
    ]);
    expect(result.actions.at(-1)).toEqual({ type: 'deliver', to: 'new-pr' });
  });

  it('re-plans after a plan review rejection, then builds once the review passes', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { 'plan-review': ['fail', 'pass'] },
      }),
    );

    expect(result.ending).toEqual({ type: 'delivered' });
    expect(stepsRun(result.attempts)).toEqual([
      'plan',
      'plan-review',
      'plan',
      'plan-review',
      'build',
      'quality-gate',
      'audit',
    ]);
    expect(result.attempts[2]).toMatchObject({
      attemptId: 'plan-2',
      feedbackFrom: 'plan-review-1',
    });
  });

  it('gives the worker a fresh attempt with gate failures after a red gate, then audits', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { 'quality-gate': ['fail', 'pass'] },
      }),
    );

    expect(result.ending).toEqual({ type: 'delivered' });
    expect(stepsRun(result.attempts)).toEqual([
      'plan',
      'plan-review',
      'build',
      'quality-gate',
      'build',
      'quality-gate',
      'audit',
    ]);
    expect(result.attempts[4]).toMatchObject({
      attemptId: 'build-2',
      feedbackFrom: 'quality-gate-1',
    });
  });

  it('reruns the build and the gate after an audit rejection, then delivers', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { audit: ['fail', 'pass'] },
      }),
    );

    expect(result.ending).toEqual({ type: 'delivered' });
    expect(stepsRun(result.attempts)).toEqual([
      'plan',
      'plan-review',
      'build',
      'quality-gate',
      'audit',
      'build',
      'quality-gate',
      'audit',
    ]);
    expect(result.attempts[5]).toMatchObject({
      attemptId: 'build-2',
      feedbackFrom: 'audit-1',
    });
  });

  it('blocks with retries_exhausted when every gate run is red, after four builds', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { 'quality-gate': ['fail', 'fail', 'fail', 'fail'] },
      }),
    );

    expect(result.ending).toEqual({
      type: 'blocked',
      reason: 'retries_exhausted',
    });
    expect(
      result.attempts.filter((attempt) => attempt.stepId === 'build'),
    ).toHaveLength(4);
  });

  it('blocks with retries_exhausted when the audit keeps rejecting, after three builds', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { audit: ['fail', 'fail', 'fail'] },
      }),
    );

    expect(result.ending).toEqual({
      type: 'blocked',
      reason: 'retries_exhausted',
    });
    expect(
      result.attempts.filter((attempt) => attempt.stepId === 'build'),
    ).toHaveLength(3);
  });

  it('restarts a crashed build from its snapshot and delivers', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { build: ['crash', 'pass'] },
      }),
    );

    expect(result.ending).toEqual({ type: 'delivered' });
    expect(result.attempts[2]).toMatchObject({ attemptId: 'build-1' });
    expect(result.attempts[3]).toMatchObject({
      attemptId: 'build-2',
      restartOf: 'build-1',
    });
    expect(result.actions).toContainEqual({
      type: 'start_attempt',
      stepId: 'build',
      n: 2,
      restartOf: 'build-1',
      restoreSnapshot: `snap-${attemptIdOf('build', 1)}`,
    });
  });

  it('blocks with infra when the restarted build crashes again', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { build: ['crash', 'crash'] },
      }),
    );

    expect(result.ending).toEqual({ type: 'blocked', reason: 'infra' });
    expect(
      result.attempts.filter((attempt) => attempt.stepId === 'build'),
    ).toHaveLength(2);
  });

  it('starts one more restart after a human unblocks an infra block', () => {
    const events = stamp([
      ev.taskCreated(),
      ev.setupFinished(),
      ev.attemptStarted('build', 1),
      ev.attemptFailed('build-1', 'crashed'),
      ev.attemptStarted('build', 2, { restartOf: 'build-1' }),
      ev.attemptFailed('build-2', 'start_failed'),
      ev.blocked('infra', 'restart failed again'),
      ev.unblocked({ extraRetry: true }),
    ]);
    const state = reduce(feature, events);

    expect(nextAction(feature, state)).toMatchObject({
      type: 'start_attempt',
      stepId: 'build',
      restartOf: 'build-2',
    });
  });

  it('blocks again once the human extra start is used up', () => {
    const events = stamp([
      ev.taskCreated(),
      ev.setupFinished(),
      ev.attemptStarted('build', 1),
      ev.attemptFailed('build-1', 'crashed'),
      ev.attemptStarted('build', 2, { restartOf: 'build-1' }),
      ev.attemptFailed('build-2', 'start_failed'),
      ev.blocked('infra', 'restart failed again'),
      ev.unblocked({ extraRetry: true }),
      ev.attemptStarted('build', 3, { restartOf: 'build-2' }),
      ev.attemptFailed('build-3', 'start_failed'),
    ]);
    const state = reduce(feature, events);

    expect(nextAction(feature, state)).toMatchObject({
      type: 'block',
      reason: 'infra',
    });
  });

  it('gives the same events and actions on every run', () => {
    const script: Script = {
      judges: featureJudges,
      outcomes: { 'quality-gate': ['fail', 'pass'] },
    };
    const first = simulate(feature, scripted(feature, script));
    const second = simulate(feature, scripted(feature, script));
    expect(second).toEqual(first);
  });

  it('bounds build attempts for any sequence of outcomes', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = seededRandom(seed);
      const pick = (): Outcome => {
        const roll = random();
        if (roll < 0.1) return 'crash';
        return roll < 0.55 ? 'fail' : 'pass';
      };
      const oracle: Oracle = (attempt) => {
        const outcome = pick();
        return finish(feature, { judges: featureJudges }, attempt, outcome);
      };

      const result = simulate(feature, oracle);
      const builds = result.attempts.filter(
        (attempt) => attempt.stepId === 'build',
      );
      const retries = builds.filter(
        (attempt) => attempt.restartOf === undefined,
      );
      const restarts = builds.length - retries.length;

      expect(retries.length, `seed ${seed}`).toBeLessThanOrEqual(6);
      expect(builds.length, `seed ${seed}`).toBeLessThanOrEqual(6 + restarts);
    }
  });
});

/** mulberry32: a small seeded generator so the property test is repeatable. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('the on-call operator, simulated in memory', () => {
  const allWorkflows = ['feature', 'standard', 'fast'] as const;

  it.each(allWorkflows)(
    'never runs on the happy path of the %s workflow',
    (name) => {
      const workflow = loadWorkflow(name);
      const judges = workflow.steps
        .filter((step) => step.type === 'agent')
        .filter((step) => step.onFail !== undefined)
        .map((step) => step.id);
      const result = simulate(workflow, scripted(workflow, { judges }));

      expect(result.ending).toEqual({ type: 'delivered' });
      expect(result.operatorRuns).toBe(0);
      expect(result.actions.map((action) => action.type)).not.toContain(
        'start_operator',
      );
    },
  );

  it('grants one extra retry, then hands the second exhaustion to a human', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { 'quality-gate': ['fail', 'fail', 'fail', 'fail', 'fail'] },
      }),
      300,
      () => [ev.unblocked({ extraRetry: true })],
    );

    expect(result.operatorRuns).toBe(1);
    expect(
      result.attempts.filter((attempt) => attempt.stepId === 'build'),
    ).toHaveLength(5);
    expect(result.ending).toEqual({
      type: 'blocked',
      reason: 'retries_exhausted',
    });
  });

  it('hands an incident to a human after the operator escalates, without a second operator (F1)', () => {
    const result = simulate(
      feature,
      scripted(feature, {
        judges: featureJudges,
        outcomes: { 'quality-gate': ['fail', 'fail', 'fail', 'fail'] },
      }),
      300,
      () => [ev.escalated('cannot fix')],
    );

    expect(result.operatorRuns).toBe(1);
    expect(result.ending).toEqual({
      type: 'blocked',
      reason: 'retries_exhausted',
    });
    expect(result.events.at(-1)).toEqual(
      ev.blocked('retries_exhausted', 'cannot fix'),
    );
  });

  it('blocks for a human, not another operator, when the operator changed the worktree (F2)', () => {
    const events = [
      ev.taskCreated(),
      ev.setupFinished(),
      ev.attemptStarted('plan', 1),
      ev.agentReady('plan-1'),
      ev.blocked('runner_prompt', 'prompt'),
      ev.operatorStarted(),
      ev.completed('operator-1'),
      ev.operatorChecked(1, true),
      ev.blocked('infra', 'operator changed worktree'),
    ];
    expect(run(feature, events).action).toEqual({ type: 'idle' });
  });

  it('keeps a task blocked for a human when the operator attempt fails', () => {
    const events = [
      ev.taskCreated(),
      ev.setupFinished(),
      ev.blocked('infra', 'boom'),
      ev.operatorStarted(),
      ev.attemptFailed('operator-1', 'stalled'),
      ev.operatorChecked(),
    ];
    expect(run(feature, events).action).toEqual({ type: 'idle' });
  });

  it('never starts the operator for a question a worker asked a human', () => {
    const events = [
      ev.taskCreated(),
      ev.setupFinished(),
      ev.attemptStarted('plan', 1),
      ev.agentReady('plan-1'),
      ev.questionAsked('plan-1', 'q1', 'human'),
    ];
    expect(run(feature, events).action).toEqual({ type: 'idle' });
  });
});
