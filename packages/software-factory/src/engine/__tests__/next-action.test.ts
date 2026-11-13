import { describe, expect, it } from 'vitest';
import type { FactoryEvent } from '../events';
import { attemptIdOf, ev, loadWorkflow, run } from './harness';

const feature = loadWorkflow('feature');
const ready: FactoryEvent[] = [ev.taskCreated(), ev.setupFinished()];

/** A finished plan, reviewed and approved: the build is next. */
const planApproved: FactoryEvent[] = [
  ...ready,
  ev.attemptStarted('plan', 1),
  ev.completed(attemptIdOf('plan', 1)),
  ev.attemptStarted('plan-review', 1),
  ev.verdict(attemptIdOf('plan-review', 1), true),
];

describe('nextAction', () => {
  describe('before the task runs', () => {
    it('does nothing when the task was never created', () => {
      expect(run(feature, []).action).toEqual({ type: 'idle' });
    });

    it('runs setup when the task exists but setup has not finished', () => {
      expect(run(feature, [ev.taskCreated()]).action).toEqual({
        type: 'setup',
      });
    });

    it('blocks with setup_failed when setup finished with an error', () => {
      const { action } = run(feature, [
        ev.taskCreated(),
        ev.setupFinished(false),
      ]);
      expect(action).toMatchObject({ type: 'block', reason: 'setup_failed' });
    });

    it('starts the first step once setup succeeded', () => {
      expect(run(feature, ready).action).toEqual({
        type: 'start_attempt',
        stepId: 'plan',
        n: 1,
      });
    });
  });

  describe('while an attempt runs', () => {
    it('watches a starting attempt', () => {
      const { action } = run(feature, [...ready, ev.attemptStarted('plan', 1)]);
      expect(action).toEqual({ type: 'watch', attemptId: 'plan-1' });
    });

    it('watches a running attempt', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.agentReady('plan-1'),
      ]);
      expect(action).toEqual({ type: 'watch', attemptId: 'plan-1' });
    });

    it('idles while a question to a human is open', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.questionAsked('plan-1', 'q1', 'human'),
      ]);
      expect(action).toEqual({ type: 'idle' });
    });

    it('starts the operator for a question addressed to it', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.questionAsked('plan-1', 'q1'),
      ]);
      expect(action).toEqual({
        type: 'start_operator',
        reason: 'question',
        detail: '?',
        questionId: 'q1',
      });
    });

    it('types the answer into the waiting agent once the question is answered', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.questionAsked('plan-1', 'q1'),
        ev.answered('q1'),
      ]);
      expect(action).toEqual({
        type: 'deliver_prompt',
        attemptId: 'plan-1',
        kind: 'answer',
        text: 'yes',
        question: '?',
      });
    });

    it('watches the agent again after the answer was delivered', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.questionAsked('plan-1', 'q1'),
        ev.answered('q1'),
        ev.promptDelivered('plan-1'),
      ]);
      expect(action).toEqual({ type: 'watch', attemptId: 'plan-1' });
    });
  });

  describe('when an agent step completes', () => {
    it('starts the next step after a completed step', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.completed('plan-1'),
      ]);
      expect(action).toEqual({
        type: 'start_attempt',
        stepId: 'plan-review',
        n: 1,
      });
    });

    it('starts the build after the plan review passes', () => {
      expect(run(feature, planApproved).action).toEqual({
        type: 'start_attempt',
        stepId: 'build',
        n: 1,
      });
    });
  });

  describe('when a judge rejects', () => {
    it('restarts the retry target with the judge feedback while budget remains', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.completed('plan-1'),
        ev.attemptStarted('plan-review', 1),
        ev.verdict('plan-review-1', false, '/evidence/review.md'),
      ]);
      expect(action).toEqual({
        type: 'start_attempt',
        stepId: 'plan',
        n: 2,
        feedbackFrom: 'plan-review-1',
      });
    });

    it('blocks with retries_exhausted once the lifetime budget is spent', () => {
      const events: FactoryEvent[] = [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.completed('plan-1'),
        ev.attemptStarted('plan-review', 1),
        ev.verdict('plan-review-1', false),
        ev.attemptStarted('plan', 2, { feedbackFrom: 'plan-review-1' }),
        ev.completed('plan-2'),
        ev.attemptStarted('plan-review', 2),
        ev.verdict('plan-review-2', false),
        ev.attemptStarted('plan', 3, { feedbackFrom: 'plan-review-2' }),
        ev.completed('plan-3'),
        ev.attemptStarted('plan-review', 3),
        ev.verdict('plan-review-3', false),
      ];
      expect(run(feature, events).action).toMatchObject({
        type: 'block',
        reason: 'retries_exhausted',
      });
    });

    it('blocks with no_retry when the failing step declares no retry', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.verdict('plan-1', false),
      ]);
      expect(action).toMatchObject({ type: 'block', reason: 'no_retry' });
    });
  });

  describe('when the quality gate fails', () => {
    const buildDone: FactoryEvent[] = [
      ...planApproved,
      ev.attemptStarted('build', 1),
      ev.completed('build-1'),
      ev.attemptStarted('quality-gate', 1),
    ];

    it('restarts the build with the gate failures while budget remains', () => {
      const { action } = run(feature, [
        ...buildDone,
        ev.gateFailed('quality-gate-1'),
      ]);
      expect(action).toEqual({
        type: 'start_attempt',
        stepId: 'build',
        n: 2,
        feedbackFrom: 'quality-gate-1',
      });
    });

    it('blocks with retries_exhausted after three gate retries', () => {
      const events: FactoryEvent[] = [
        ...buildDone,
        ev.gateFailed('quality-gate-1'),
      ];
      for (let round = 2; round <= 4; round += 1) {
        events.push(
          ev.attemptStarted('build', round, {
            feedbackFrom: `quality-gate-${round - 1}`,
          }),
          ev.completed(attemptIdOf('build', round)),
          ev.attemptStarted('quality-gate', round),
          ev.gateFailed(attemptIdOf('quality-gate', round)),
        );
      }
      expect(run(feature, events).action).toMatchObject({
        type: 'block',
        reason: 'retries_exhausted',
      });
    });
  });

  describe('when an infrastructure failure happens', () => {
    const buildRunning: FactoryEvent[] = [
      ...planApproved,
      ev.attemptStarted('build', 1),
    ];

    it('restarts the attempt from its snapshot on the first crash', () => {
      const { action } = run(feature, [
        ...buildRunning,
        ev.attemptFailed('build-1', 'crashed'),
      ]);
      expect(action).toEqual({
        type: 'start_attempt',
        stepId: 'build',
        n: 2,
        restartOf: 'build-1',
        restoreSnapshot: 'snap-build-1',
      });
    });

    it('restarts after a timeout the same way as after a crash', () => {
      const { action } = run(feature, [
        ...buildRunning,
        ev.attemptFailed('build-1', 'timed_out'),
      ]);
      expect(action).toMatchObject({
        type: 'start_attempt',
        restartOf: 'build-1',
      });
    });

    it('blocks with infra when the restarted attempt fails too', () => {
      const { action } = run(feature, [
        ...buildRunning,
        ev.attemptFailed('build-1', 'crashed'),
        ev.attemptStarted('build', 2, { restartOf: 'build-1' }),
        ev.attemptFailed('build-2', 'crashed'),
      ]);
      expect(action).toMatchObject({ type: 'block', reason: 'infra' });
    });

    it('keeps the feedback of the failure being fixed when restarting', () => {
      const { action } = run(feature, [
        ...planApproved,
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        ev.attemptStarted('quality-gate', 1),
        ev.gateFailed('quality-gate-1'),
        ev.attemptStarted('build', 2, { feedbackFrom: 'quality-gate-1' }),
        ev.attemptFailed('build-2', 'crashed'),
      ]);
      expect(action).toEqual({
        type: 'start_attempt',
        stepId: 'build',
        n: 3,
        restartOf: 'build-2',
        feedbackFrom: 'quality-gate-1',
        restoreSnapshot: 'snap-build-2',
      });
    });

    it('ignores a late completion of an attempt that already failed', () => {
      const { action } = run(feature, [
        ...buildRunning,
        ev.attemptFailed('build-1', 'timed_out'),
        ev.attemptStarted('build', 2, { restartOf: 'build-1' }),
        ev.completed('build-1'),
      ]);
      expect(action).toEqual({ type: 'watch', attemptId: 'build-2' });
    });
  });

  describe('when the task is finished', () => {
    it('delivers once every step has passed', () => {
      const events: FactoryEvent[] = [
        ...planApproved,
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        ev.attemptStarted('quality-gate', 1),
        ev.gatePassed('quality-gate-1'),
        ev.attemptStarted('audit', 1),
        ev.verdict('audit-1', true),
      ];
      expect(run(feature, events).action).toEqual({
        type: 'deliver',
        to: 'new-pr',
      });
    });

    it('keeps delivering while a delivery is in progress', () => {
      const events: FactoryEvent[] = [
        ...planApproved,
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        ev.attemptStarted('quality-gate', 1),
        ev.gatePassed('quality-gate-1'),
        ev.attemptStarted('audit', 1),
        ev.verdict('audit-1', true),
        ev.deliveryStarted('new-pr'),
      ];
      expect(run(feature, events).action).toEqual({
        type: 'deliver',
        to: 'new-pr',
      });
    });

    it('idles once delivered', () => {
      const events: FactoryEvent[] = [
        ...ready,
        ev.deliveryStarted(),
        ev.delivered(),
      ];
      expect(run(feature, events).action).toEqual({ type: 'idle' });
    });

    it('idles while blocked on a reason the operator never triages', () => {
      const events: FactoryEvent[] = [
        ...ready,
        ev.blocked('delivery_failed', 'x'),
      ];
      expect(run(feature, events).action).toEqual({ type: 'idle' });
    });

    it('resumes after the operator unblocks', () => {
      const events: FactoryEvent[] = [
        ...ready,
        ev.blocked('infra', 'x'),
        ev.unblocked(),
      ];
      expect(run(feature, events).action).toEqual({
        type: 'start_attempt',
        stepId: 'plan',
        n: 1,
      });
    });
  });

  describe('the on-call operator', () => {
    const exhausted: FactoryEvent[] = [
      ...ready,
      ev.attemptStarted('build', 1),
      ev.completed('build-1'),
      ev.attemptStarted('quality-gate', 1),
      ev.gateFailed('quality-gate-1'),
      ev.blocked('retries_exhausted', 'budget'),
    ];
    const runnerPrompt: FactoryEvent[] = [
      ...ready,
      ev.attemptStarted('plan', 1),
      ev.agentReady('plan-1'),
      ev.blocked('runner_prompt', 'prompt'),
    ];

    it.each([
      ['retries_exhausted', exhausted],
      ['runner_prompt', runnerPrompt],
      ['infra', [...ready, ev.blocked('infra', 'boom')]],
    ] as const)('starts for a %s block', (reason, events) => {
      expect(run(feature, [...events]).action).toMatchObject({
        type: 'start_operator',
        reason,
      });
    });

    it.each([
      'no_retry',
      'setup_failed',
      'delivery_failed',
      'question',
    ] as const)('never starts for a %s block', (reason) => {
      const { action } = run(feature, [...ready, ev.blocked(reason, 'x')]);
      expect(action).toEqual({ type: 'idle' });
    });

    it('never starts when setup failed', () => {
      const { action } = run(feature, [
        ev.taskCreated(),
        ev.setupFinished(false),
        ev.blocked('setup_failed', 'x'),
      ]);
      expect(action).toEqual({ type: 'idle' });
    });

    it('never starts for a delivery failure', () => {
      const { action } = run(feature, [
        ...ready,
        ev.deliveryStarted(),
        { type: 'delivery_failed', detail: 'push refused' },
      ]);
      expect(action).toEqual({ type: 'idle' });
    });

    it('starts at most once per incident: an escalation ends in a human block', () => {
      const events: FactoryEvent[] = [
        ...exhausted,
        ev.operatorStarted(),
        ev.escalated('needs a human'),
        ev.completed('operator-1'),
        ev.operatorChecked(),
      ];
      expect(run(feature, events).action).toEqual({
        type: 'block',
        reason: 'retries_exhausted',
        detail: 'needs a human',
      });
      expect(
        run(feature, [
          ...events,
          ev.blocked('retries_exhausted', 'needs a human'),
        ]).action,
      ).toEqual({ type: 'idle' });
    });

    it('does not start again when the operator itself caused the block', () => {
      const events: FactoryEvent[] = [
        ...exhausted,
        ev.operatorStarted(),
        ev.completed('operator-1'),
        ev.operatorChecked(1, true),
        ev.blocked('infra', 'operator changed worktree'),
      ];
      expect(run(feature, events).action).toEqual({ type: 'idle' });
    });

    it('waits for a human when the operator attempt failed', () => {
      const events: FactoryEvent[] = [
        ...exhausted,
        ev.operatorStarted(),
        ev.attemptFailed('operator-1', 'timed_out'),
        ev.operatorChecked(),
      ];
      expect(run(feature, events).action).toEqual({ type: 'idle' });
    });

    it('watches a live operator, then inspects it once it ended', () => {
      const live = [
        ...exhausted,
        ev.operatorStarted(),
        ev.agentReady('operator-1'),
      ];
      expect(run(feature, live).action).toEqual({
        type: 'watch',
        attemptId: 'operator-1',
      });
      expect(
        run(feature, [...live, ev.completed('operator-1')]).action,
      ).toEqual({ type: 'watch', attemptId: 'operator-1' });
    });

    it('does not start without an operator declared by the workflow', () => {
      const bare = { ...feature };
      delete bare.operator;
      const { action } = run(bare, [...ready, ev.blocked('infra', 'x')]);
      expect(action).toEqual({ type: 'idle' });
    });

    it('does not start for a question once the operator ran for it', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.questionAsked('plan-1', 'q1'),
        ev.operatorStarted(),
        ev.completed('operator-1'),
        ev.operatorChecked(),
      ]);
      expect(action).toEqual({ type: 'idle' });
    });

    it('escalates an unresolved question to a human block', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.questionAsked('plan-1', 'q1'),
        ev.operatorStarted(),
        ev.completed('operator-1'),
        ev.operatorChecked(),
        ev.escalated('cannot answer'),
      ]);
      expect(action).toEqual({
        type: 'block',
        reason: 'question',
        detail: 'cannot answer',
      });
    });

    it('starts once more for a new incident after an unblock', () => {
      const { action } = run(feature, [
        ...runnerPrompt,
        ev.operatorStarted(),
        ev.unblocked({ nudge: 'y' }),
        ev.completed('operator-1'),
        ev.operatorChecked(),
        ev.promptDelivered('plan-1', 'nudge'),
        ev.blocked('runner_prompt', 'again'),
      ]);
      expect(action).toMatchObject({ type: 'start_operator' });
    });
  });

  describe('the extra retry', () => {
    it('restarts the build after an unblock with an extra retry', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        ev.attemptStarted('quality-gate', 1),
        ev.gateFailed('quality-gate-1'),
        ev.blocked('retries_exhausted', 'x'),
        ev.unblocked({ extraRetry: true }),
      ]);
      expect(action).toMatchObject({
        type: 'start_attempt',
        stepId: 'build',
        feedbackFrom: 'quality-gate-1',
      });
    });

    it('adds exactly one retry to the budget', () => {
      const failedRound = (round: number): FactoryEvent[] => [
        ev.attemptStarted('build', round, {
          ...(round > 1 ? { feedbackFrom: `quality-gate-${round - 1}` } : {}),
        }),
        ev.completed(`build-${round}`),
        ev.attemptStarted('quality-gate', round),
        ev.gateFailed(`quality-gate-${round}`),
      ];
      const events: FactoryEvent[] = [
        ...ready,
        ...[1, 2, 3, 4].flatMap(failedRound),
        ev.blocked('retries_exhausted', 'x'),
        ev.unblocked({ extraRetry: true }),
      ];
      expect(run(feature, events).action).toMatchObject({
        type: 'start_attempt',
        stepId: 'build',
        n: 5,
      });
    });
  });

  describe('prompt delivery', () => {
    it('does not deliver into a blocked pane', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.agentReady('plan-1'),
        ev.questionAsked('plan-1', 'q1', 'human'),
        ev.answered('q1', 'human'),
        ev.blocked('runner_prompt', 'prompt'),
      ]);
      expect(action).toMatchObject({ type: 'start_operator' });
    });

    it('delivers the nudge once the block lifted', () => {
      const { action } = run(feature, [
        ...ready,
        ev.attemptStarted('plan', 1),
        ev.agentReady('plan-1'),
        ev.blocked('runner_prompt', 'prompt'),
        ev.unblocked({ nudge: 'y' }),
      ]);
      expect(action).toEqual({
        type: 'deliver_prompt',
        attemptId: 'plan-1',
        kind: 'nudge',
        text: 'y',
      });
    });
  });
});
