import { describe, expect, it } from 'vitest';
import { resolveAttemptContext } from '../context';
import { reduce } from '../reduce';
import { attemptIdOf, ev, failure, loadWorkflow, stamp } from './harness';

const feature = loadWorkflow('feature');

describe('resolveAttemptContext', () => {
  it('gives the build the plan artifact of the passing plan attempt', () => {
    const started = ev.attemptStarted('plan', 1);
    const planPassed = {
      ...started,
      artifacts: { plan: '/evidence/plan-1/plan.md' },
    };
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        planPassed,
        ev.completed('plan-1'),
        ev.attemptStarted('plan-review', 1),
        ev.verdict('plan-review-1', true),
      ]),
    );
    const context = resolveAttemptContext(feature, state, 'build');
    expect(context.inputs).toEqual([
      {
        kind: 'artifact',
        stepId: 'plan',
        artifactKey: 'plan',
        attemptId: 'plan-1',
        path: '/evidence/plan-1/plan.md',
      },
    ]);
    expect(context.feedback).toBeUndefined();
  });

  it('leaves an input path undefined when no attempt of its step has passed', () => {
    const state = reduce(
      feature,
      stamp([ev.taskCreated(), ev.setupFinished()]),
    );
    const context = resolveAttemptContext(feature, state, 'plan-review');
    expect(context.inputs).toEqual([
      {
        kind: 'artifact',
        stepId: 'plan',
        artifactKey: 'plan',
        attemptId: undefined,
        path: undefined,
      },
    ]);
  });

  it('gives the audit no gate pass before the gate has passed', () => {
    const state = reduce(
      feature,
      stamp([ev.taskCreated(), ev.setupFinished()]),
    );
    const gate = resolveAttemptContext(feature, state, 'audit').inputs.find(
      (input) => input.kind === 'gate',
    );
    expect(gate).toEqual({
      kind: 'gate',
      stepId: 'quality-gate',
      attemptId: undefined,
      commands: expect.any(Array),
    });
  });

  it('gives the audit the passing gate attempt and its declared commands', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('quality-gate', 1),
        ev.gatePassed('quality-gate-1'),
      ]),
    );
    const gate = resolveAttemptContext(feature, state, 'audit').inputs.find(
      (input) => input.kind === 'gate',
    );
    const step = feature.steps.find((s) => s.id === 'quality-gate');
    expect(gate).toEqual({
      kind: 'gate',
      stepId: 'quality-gate',
      attemptId: 'quality-gate-1',
      commands: step?.type === 'commands' ? step.exec : [],
    });
  });

  it('gives a judge retry the judge feedback file', () => {
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
    expect(resolveAttemptContext(feature, state, 'plan').feedback).toEqual({
      kind: 'verdict',
      fromAttempt: 'plan-review-1',
      feedbackPath: '/evidence/review.md',
    });
  });

  it('gives a build retry the gate failures', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        ev.attemptStarted('quality-gate', 1),
        ev.gateFailed('quality-gate-1', 'lint broke'),
      ]),
    );
    expect(resolveAttemptContext(feature, state, 'build').feedback).toEqual({
      kind: 'gate',
      fromAttempt: 'quality-gate-1',
      failures: [failure('lint broke')],
    });
  });

  it('keeps the original feedback for a restart after a crash', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('build', 1),
        ev.completed('build-1'),
        ev.attemptStarted('quality-gate', 1),
        ev.gateFailed('quality-gate-1', 'lint broke'),
        ev.attemptStarted('build', 2, { feedbackFrom: 'quality-gate-1' }),
        ev.attemptFailed(attemptIdOf('build', 2), 'crashed'),
        ev.attemptStarted('build', 3, {
          restartOf: 'build-2',
          feedbackFrom: 'quality-gate-1',
        }),
      ]),
    );
    expect(resolveAttemptContext(feature, state, 'build').feedback).toEqual({
      kind: 'gate',
      fromAttempt: 'quality-gate-1',
      failures: [failure('lint broke')],
    });
  });

  it('gives a step no feedback when nothing failed for it', () => {
    const state = reduce(
      feature,
      stamp([ev.taskCreated(), ev.setupFinished()]),
    );
    expect(
      resolveAttemptContext(feature, state, 'plan').feedback,
    ).toBeUndefined();
  });

  it('hands a note to the step it names, in the order written, and to no other', () => {
    const state = reduce(
      feature,
      stamp([
        ev.taskCreated(),
        ev.setupFinished(),
        ev.attemptStarted('plan', 1),
        ev.agentReady('plan-1'),
        ev.note('plan-1', 'build', 'first'),
        ev.note('plan-1', 'audit', 'for the audit'),
        ev.note('plan-1', 'build', 'second'),
        ev.note('plan-1', 'human', 'for a human'),
        ev.completed('plan-1'),
      ]),
    );
    expect(resolveAttemptContext(feature, state, 'build').notes).toEqual([
      { fromStep: 'plan', text: 'first' },
      { fromStep: 'plan', text: 'second' },
    ]);
    expect(resolveAttemptContext(feature, state, 'plan').notes).toEqual([]);
  });
});
