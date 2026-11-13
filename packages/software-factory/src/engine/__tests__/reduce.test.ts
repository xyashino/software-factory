import { describe, expect, it } from 'vitest';
import { reduce } from '../reduce';
import { attemptIdOf, ev, failure, loadWorkflow, stamp } from './harness';

const feature = loadWorkflow('feature');

describe('reduce', () => {
  it('starts with no task, no setup and the cursor on the first step', () => {
    const state = reduce(feature, []);
    expect(state).toMatchObject({
      status: 'setting_up',
      task: undefined,
      setupOk: undefined,
      cursor: 0,
      attempts: [],
      current: undefined,
    });
  });

  it('records the task and setup result', () => {
    const state = reduce(
      feature,
      stamp([ev.taskCreated(), ev.setupFinished()]),
    );
    expect(state.task).toEqual({
      workflow: 'feature',
      todoPath: 'todos/task.md',
      branch: 'feat/task',
    });
    expect(state.setupOk).toBe(true);
    expect(state.status).toBe('running');
  });

  it('moves the cursor to the started step and past it when the step completes', () => {
    const started = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('plan', 1),
      ]),
    );
    expect(started.cursor).toBe(0);

    const completed = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('plan', 1),
        ev.completed('plan-1'),
      ]),
    );
    expect(completed.cursor).toBe(1);
    expect(completed.lastPassed).toEqual({ plan: 'plan-1' });
  });

  it('counts a retry against the failing step, not the retried one', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('plan', 1),
        ev.completed('plan-1'),
        ev.attemptStarted('plan-review', 1),
        ev.verdict('plan-review-1', false, '/evidence/review.md'),
        ev.attemptStarted('plan', 2, { feedbackFrom: 'plan-review-1' }),
      ]),
    );
    expect(state.retriesUsed).toEqual({ 'plan-review': 1 });
    expect(state.cursor).toBe(0);
  });

  it('keeps retry counts across the whole task instead of resetting them', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        ev.attemptStarted('quality-gate', 1),
        ev.gateFailed('quality-gate-1'),
        ev.attemptStarted('build', 2, { feedbackFrom: 'quality-gate-1' }),
        ev.completed('build-2'),
        ev.attemptStarted('quality-gate', 2),
        ev.gateFailed('quality-gate-2'),
        ev.attemptStarted('build', 3, { feedbackFrom: 'quality-gate-2' }),
      ]),
    );
    expect(state.retriesUsed).toEqual({ 'quality-gate': 2 });
  });

  it('does not count an infrastructure restart as a retry', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('build', 1),
        ev.attemptFailed('build-1', 'crashed'),
        ev.attemptStarted('build', 2, { restartOf: 'build-1' }),
      ]),
    );
    expect(state.retriesUsed).toEqual({});
  });

  it('records gate failures and the feedback that the retry will receive', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        ev.attemptStarted('quality-gate', 1),
        ev.gateFailed('quality-gate-1', 'boom'),
      ]),
    );
    const gate = state.attempts.find(
      (attempt) => attempt.attemptId === 'quality-gate-1',
    );
    expect(gate).toMatchObject({ status: 'failed', outcome: 'gate_fail' });
    expect(gate?.failures).toEqual([failure('boom')]);
    expect(state.pendingFeedback).toEqual({
      forStep: 'build',
      fromAttempt: 'quality-gate-1',
    });
  });

  it('ignores events for an attempt that is no longer the latest', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('build', 1),
        ev.attemptFailed('build-1', 'timed_out'),
        ev.attemptStarted('build', 2, { restartOf: 'build-1' }),
        ev.completed('build-1'),
      ]),
    );
    expect(state.current).toMatchObject({
      attemptId: attemptIdOf('build', 2),
      status: 'starting',
    });
    expect(state.lastPassed).toEqual({});
    expect(state.cursor).toBe(2);
  });

  it('stores reported usage on the attempt without changing its status', () => {
    const events = stamp([
      ev.taskCreated(),
      ev.setupFinished(),
      ev.attemptStarted('build', 1),
      ev.agentReady('build-1'),
      {
        type: 'usage_recorded',
        attemptId: 'build-1',
        model: 'sonnet',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.5,
      },
    ]);
    const state = reduce(feature, events);
    expect(state.current).toMatchObject({
      status: 'running',
      usage: {
        model: 'sonnet',
        inputTokens: 100,
        outputTokens: 20,
        costUsd: 0.5,
      },
    });
  });

  it('stores usage that arrives after the attempt finished', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        {
          type: 'usage_recorded',
          attemptId: 'build-1',
          model: 'sonnet',
          inputTokens: 1,
          outputTokens: 2,
        },
      ]),
    );
    expect(state.attempts[0]).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 1, outputTokens: 2 },
    });
  });

  it('ignores a verdict for an attempt that already finished', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('plan', 1),
        ev.completed('plan-1'),
        ev.attemptStarted('plan-review', 1),
        ev.verdict('plan-review-1', true),
        ev.verdict('plan-review-1', false),
      ]),
    );
    expect(state.attempts.at(-1)?.outcome).toBe('verdict_pass');
  });

  it('counts reminders per kind for the running attempt', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('plan', 1),
        ev.reminder('plan-1', 'idle'),
        ev.reminder('plan-1', 'idle'),
        ev.reminder('plan-1', 'silent'),
      ]),
    );
    expect(state.current?.reminders).toEqual({ idle: 2, silent: 1 });
  });

  it('reports waiting while a question is open and running again once answered', () => {
    const asked = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('plan', 1),
        ev.questionAsked('plan-1', 'q1'),
      ]),
    );
    expect(asked.status).toBe('waiting');
    expect(asked.openQuestion).toEqual({
      questionId: 'q1',
      to: 'operator',
      attemptId: 'plan-1',
      text: '?',
      askedAt: 4000,
    });

    const answered = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('plan', 1),
        ev.questionAsked('plan-1', 'q1'),
        ev.answered('q1'),
      ]),
    );
    expect(answered.status).toBe('running');
    expect(answered.openQuestion).toBeUndefined();
  });

  it('derives delivering, delivered and blocked statuses', () => {
    const base = [ev.taskCreated(), ev.setupFinished()];
    expect(reduce(feature, stamp([...base, ev.deliveryStarted()])).status).toBe(
      'delivering',
    );
    expect(
      reduce(feature, stamp([...base, ev.deliveryStarted(), ev.delivered()]))
        .status,
    ).toBe('delivered');
    expect(
      reduce(feature, stamp([...base, ev.blocked('infra', 'x')])).status,
    ).toBe('blocked');
    expect(
      reduce(
        feature,
        stamp([...base, ev.blocked('infra', 'x'), ev.unblocked()]),
      ).status,
    ).toBe('running');
  });

  it('derives parked for a final block and running once it is unblocked', () => {
    const base = [ev.taskCreated(), ev.setupFinished()];
    const blocked = [...base, ev.blocked('infra', 'x')];
    expect(
      reduce(feature, stamp([...blocked, { type: 'parked' }])).status,
    ).toBe('parked');
    expect(
      reduce(
        feature,
        stamp([
          ...blocked,
          { type: 'delivered_blocked', prUrl: 'https://example.test/pr/1' },
        ]),
      ).status,
    ).toBe('parked');
    expect(
      reduce(feature, stamp([...blocked, { type: 'parked' }, ev.unblocked()]))
        .status,
    ).toBe('running');
  });

  it('is a pure fold: the same events always give the same state', () => {
    const events = stamp([
      ev.taskCreated(),
      ev.setupFinished(),
      ev.attemptStarted('plan', 1),
      ev.completed('plan-1'),
    ]);
    expect(reduce(feature, events)).toEqual(reduce(feature, events));
  });

  describe('communication', () => {
    const running = [
      ev.taskCreated(),
      ev.setupFinished(),
      ev.attemptStarted('plan', 1),
      ev.agentReady('plan-1'),
    ];

    it('pauses the asking attempt while the question is open', () => {
      const state = reduce(
        feature,
        stamp([...running, ev.questionAsked('plan-1', 'q1')]),
      );
      expect(state.current?.pausedSince).toBe(5000);
      expect(state.current?.pausedMs).toBe(0);
    });

    it('excludes the waiting time once the question is answered', () => {
      const state = reduce(feature, [
        ...stamp(running),
        { at: 10_000, event: ev.questionAsked('plan-1', 'q1') },
        { at: 70_000, event: ev.answered('q1') },
      ]);
      expect(state.current?.pausedMs).toBe(60_000);
      expect(state.current?.pausedSince).toBeUndefined();
    });

    it('queues the answer for the asking agent with its question', () => {
      const state = reduce(
        feature,
        stamp([
          ...running,
          ev.questionAsked('plan-1', 'q1'),
          ev.answered('q1'),
        ]),
      );
      expect(state.pendingPrompts).toEqual([
        { attemptId: 'plan-1', kind: 'answer', text: 'yes', question: '?' },
      ]);
    });

    it('ignores an answer to a question that is not the open one', () => {
      const state = reduce(
        feature,
        stamp([
          ...running,
          ev.questionAsked('plan-1', 'q1'),
          ev.answered('other'),
        ]),
      );
      expect(state.openQuestion?.questionId).toBe('q1');
      expect(state.pendingPrompts).toEqual([]);
    });

    it('drops the queued prompt once it is delivered', () => {
      const state = reduce(
        feature,
        stamp([
          ...running,
          ev.questionAsked('plan-1', 'q1'),
          ev.answered('q1'),
          ev.promptDelivered('plan-1', 'answer'),
        ]),
      );
      expect(state.pendingPrompts).toEqual([]);
    });

    it('collects notes with the step that wrote them', () => {
      const state = reduce(
        feature,
        stamp([...running, ev.note('plan-1', 'build', 'use the cache')]),
      );
      expect(state.notes).toEqual([
        {
          fromAttempt: 'plan-1',
          fromStep: 'plan',
          toStep: 'build',
          text: 'use the cache',
        },
      ]);
    });

    it('ignores a note from an attempt that already ended', () => {
      const state = reduce(
        feature,
        stamp([...running, ev.completed('plan-1'), ev.note('plan-1', 'build')]),
      );
      expect(state.notes).toEqual([]);
    });
  });

  describe('operator', () => {
    const blockedBuild = [
      ev.taskCreated(),
      ev.setupFinished(),
      ev.attemptStarted('build', 1),
      ev.gateFailed('build-1'),
      ev.blocked('retries_exhausted', 'x'),
    ];

    it('tracks the operator attempt apart from the assembly line', () => {
      const state = reduce(
        feature,
        stamp([
          ...blockedBuild,
          ev.operatorStarted(),
          ev.agentReady('operator-1'),
        ]),
      );
      expect(state.operator?.status).toBe('running');
      expect(state.operatorRan).toBe(true);
      expect(state.current?.attemptId).toBe('build-1');
      expect(state.attempts).toHaveLength(1);
    });

    it('does not advance the cursor when the operator completes', () => {
      const before = reduce(feature, stamp(blockedBuild));
      const after = reduce(
        feature,
        stamp([
          ...blockedBuild,
          ev.operatorStarted(),
          ev.completed('operator-1'),
        ]),
      );
      expect(after.cursor).toBe(before.cursor);
      expect(after.operator?.status).toBe('completed');
    });

    it('keeps the operator as ran across a re-block of the same incident', () => {
      const state = reduce(
        feature,
        stamp([
          ...blockedBuild,
          ev.operatorStarted(),
          ev.escalated(),
          ev.blocked('retries_exhausted', 'escalated'),
        ]),
      );
      expect(state.operatorRan).toBe(true);
      expect(state.escalation).toBeUndefined();
    });

    it('lets the operator run again once an unblock ends the incident', () => {
      const state = reduce(
        feature,
        stamp([
          ...blockedBuild,
          ev.operatorStarted(),
          ev.unblocked({ extraRetry: true }),
        ]),
      );
      expect(state.operatorRan).toBe(false);
      expect(state.extraRetry).toEqual({ stepId: 'build' });
      expect(state.block).toBeUndefined();
    });

    it('does not reset operatorRan when unblocked by operator until the step passes', () => {
      const state = reduce(
        feature,
        stamp([
          ...blockedBuild,
          ev.operatorStarted(),
          { type: 'unblocked', by: 'operator', nudge: '1' },
        ]),
      );
      expect(state.operatorRan).toBe(true);
      expect(state.block).toBeUndefined();

      const passedState = reduce(
        feature,
        stamp([
          ...blockedBuild,
          ev.operatorStarted(),
          { type: 'unblocked', by: 'operator', nudge: '1' },
          ev.attemptStarted('build', 2),
          ev.completed('build-2'),
        ]),
      );
      expect(passedState.operatorRan).toBe(false);
    });

    it('clears escalation when unblocked', () => {
      const state = reduce(
        feature,
        stamp([
          ...blockedBuild,
          ev.operatorStarted(),
          ev.escalated('needs human help'),
          ev.unblocked({ extraRetry: true }),
        ]),
      );
      expect(state.escalation).toBeUndefined();
    });

    it('queues a nudge for the live agent', () => {
      const state = reduce(
        feature,
        stamp([
          ev.taskCreated(),
          ev.setupFinished(),
          ev.attemptStarted('plan', 1),
          ev.agentReady('plan-1'),
          ev.blocked('runner_prompt'),
          ev.unblocked({ nudge: 'y' }),
        ]),
      );
      expect(state.pendingPrompts).toEqual([
        { attemptId: 'plan-1', kind: 'nudge', text: 'y' },
      ]);
    });

    it('applies a late event of the worker after the operator started', () => {
      const state = reduce(
        feature,
        stamp([
          ev.taskCreated(),
          ev.setupFinished(),
          ev.attemptStarted('plan', 1),
          ev.agentReady('plan-1'),
          ev.blocked('runner_prompt'),
          ev.operatorStarted(),
          ev.completed('plan-1'),
        ]),
      );
      expect(state.attempts[0]?.status).toBe('completed');
    });
  });
});
