import { describe, expect, it } from 'vitest';
import {
  andonRaised,
  blobOf,
  created,
  cycleBlocked,
  cycleFailed,
  cycleHandedOver,
  cycleIdOf,
  inspectionFinished,
  noteLeft,
  questionAbandoned,
  questionAnswered,
  questionAsked,
  resumeIdOf,
  resumed,
  stationOf,
  verdictRecorded,
} from './builders';
import {
  begun,
  claim,
  passedStation,
  passedVerdict,
  start,
  stateOf,
} from './histories';
import type { CycleCause, OrderEvent } from '../events';
import { resolveCycleContext } from '../context';
import type { WorkOrderState } from '../state';

const contextFor = (
  events: OrderEvent[],
  station: string,
  cause: CycleCause = { kind: 'first' },
) => resolveCycleContext(stateOf(events), stationOf(station), cause);
const planPassedEvents = (): OrderEvent[] => [
  created(),
  ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
];

describe('resolveCycleContext for a first Cycle', () => {
  it('starts with the order and no feedback, resume or restart', () => {
    const result = contextFor([created()], 'plan');

    expect(result).toEqual({
      inputs: [
        { kind: 'order', field: 'title', value: 'Add the core model' },
        {
          kind: 'order',
          field: 'body',
          blob: blobOf(8),
          materialiseAs: '.worker/inputs/order.body',
        },
        { kind: 'order', field: 'branch', value: 'v2-02-demo' },
      ],
      notes: [],
      nudges: [],
      priorQuestions: [],
      outputs: [{ key: 'plan', path: '.worker/outputs/plan' }],
    });
  });

  it('carries the order body as a relative input, never an absolute path', () => {
    const result = contextFor([created()], 'plan');

    const body = result.inputs.find(
      (input) => input.kind === 'order' && input.field === 'body',
    );
    expect(body).toMatchObject({
      materialiseAs: '.worker/inputs/order.body',
    });
    expect(JSON.stringify(result)).not.toMatch(/"\/\.worker/);
  });

  it('hands the artifacts of earlier passed Stations in as inputs', () => {
    const result = contextFor(planPassedEvents(), 'build');

    expect(result.inputs).toContainEqual({
      kind: 'artifact',
      stationId: stationOf('plan'),
      key: 'plan',
      cycleId: cycleIdOf(1),
      blob: blobOf(2),
      materialiseAs: '.worker/inputs/plan.plan',
    });
  });

  it('gives only relative paths, never an absolute one', () => {
    const result = contextFor(planPassedEvents(), 'audit');
    const paths = [
      ...result.inputs.flatMap((input) =>
        input.kind === 'artifact' ? [input.materialiseAs] : [],
      ),
      ...result.outputs.map((output) => output.path),
    ];

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => !path.startsWith('/'))).toBe(true);
  });

  it('carries the notes an earlier Station left for this one', () => {
    const events = [created(), claim(1), start(1, 'plan'), noteLeft()];

    const result = contextFor(events, 'build');

    expect(result.notes).toEqual([
      { fromStation: stationOf('plan'), text: 'the plan keeps the api small' },
    ]);
  });
});

describe('resolveCycleContext for a retry', () => {
  it('gives the verdict feedback of the failed verdict', () => {
    const events = [
      ...planPassedEvents(),
      ...passedStation(2, 'build', 4),
      ...begun(3, 'audit'),
      verdictRecorded({
        cycleId: cycleIdOf(3),
        pass: false,
        artifacts: {},
        feedbackBlob: blobOf(4),
      }),
    ];

    const result = contextFor(events, 'build', {
      kind: 'retry',
      feedbackFrom: cycleIdOf(3),
    });

    expect(result.feedback).toEqual({
      kind: 'verdict',
      fromCycle: cycleIdOf(3),
      blob: blobOf(4),
    });
  });

  it('gives the Inspection results and logs of the failed Inspection', () => {
    const inspectionResult = {
      command: 'pnpm test',
      exitCode: 1,
      timedOut: false,
      durationMs: 12,
      tail: 'failure',
      logBlob: blobOf(5),
    };
    const events = [
      ...planPassedEvents(),
      ...passedStation(2, 'build', 4),
      ...passedVerdict(3, 6),
      claim(4, 'run_inspection'),
      start(4, 'check'),
      inspectionFinished({
        cycleId: cycleIdOf(4),
        passed: false,
        results: [inspectionResult],
      }),
    ];

    const result = contextFor(events, 'build', {
      kind: 'retry',
      feedbackFrom: cycleIdOf(4),
    });

    expect(result.feedback).toEqual({
      kind: 'inspection',
      fromCycle: cycleIdOf(4),
      results: [inspectionResult],
      logBlobs: [blobOf(5)],
    });
  });

  it('keeps the feedback of a retry that was restarted', () => {
    const events = [
      ...planPassedEvents(),
      ...passedStation(2, 'build', 4),
      ...begun(3, 'audit'),
      verdictRecorded({
        cycleId: cycleIdOf(3),
        pass: false,
        artifacts: {},
        feedbackBlob: blobOf(4),
      }),
      claim(4),
      start(4, 'build', {
        cause: { kind: 'retry', feedbackFrom: cycleIdOf(3) },
        count: 2,
      }),
      cycleFailed({ cycleId: cycleIdOf(4), reason: 'timed_out' }),
    ];

    const result = contextFor(events, 'build', {
      kind: 'restart',
      of: cycleIdOf(4),
    });

    expect(result.feedback).toMatchObject({ kind: 'verdict', blob: blobOf(4) });
    expect(result.restart?.of).toBe(cycleIdOf(4));
  });
});

describe('resolveCycleContext for a restart', () => {
  it('names the failed Cycle and why it ended', () => {
    const events = [
      created(),
      claim(1),
      start(1, 'plan'),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
    ];

    const result = contextFor(events, 'plan', {
      kind: 'restart',
      of: cycleIdOf(1),
    });

    expect(result.restart).toEqual({
      of: cycleIdOf(1),
      reason: 'a previous Cycle ended as timed_out',
    });
    expect(result.feedback).toBeUndefined();
  });
});

describe('resolveCycleContext for a handover', () => {
  it('gives the Handover of the handed-over Cycle', () => {
    const events = [
      created(),
      claim(1),
      start(1, 'plan'),
      cycleHandedOver({ cycleId: cycleIdOf(1), handoverBlob: blobOf(4) }),
    ];

    const result = contextFor(events, 'plan', {
      kind: 'handover',
      of: cycleIdOf(1),
    });

    expect(result.handover).toEqual({
      fromCycle: cycleIdOf(1),
      handoverBlob: blobOf(4),
    });
  });
});

describe('resolveCycleContext for a resume', () => {
  it('resumes from the named Cycle with its Handover and the note', () => {
    const events = [
      created(),
      claim(1),
      start(1, 'plan'),
      cycleBlocked({ cycleId: cycleIdOf(1), handoverBlob: blobOf(4) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({ mode: { kind: 'retry_station' }, noteBlob: blobOf(6) }),
    ];

    const result = contextFor(events, 'plan', {
      kind: 'resume',
      of: cycleIdOf(1),
      resumeId: resumeIdOf(1),
    });

    expect(result.resume).toEqual({
      fromCycle: cycleIdOf(1),
      handoverBlob: blobOf(4),
      noteBlob: blobOf(6),
    });
  });

  it('resumes from the checkpoint without a named Cycle', () => {
    const events = [
      ...planPassedEvents(),
      ...begun(2, 'build'),
      cycleBlocked({ cycleId: cycleIdOf(2), handoverBlob: blobOf(4) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({
        mode: { kind: 'restart_from', stationId: stationOf('plan') },
        noteBlob: blobOf(6),
      }),
    ];

    const result = contextFor(events, 'plan', {
      kind: 'resume',
      resumeId: resumeIdOf(1),
    });

    expect(result.resume).toEqual({ noteBlob: blobOf(6) });
    expect(result.resume).not.toHaveProperty('fromCycle');
  });
});

describe('resolveCycleContext prior questions', () => {
  it('keeps the questions of earlier Cycles, abandoned or answered', () => {
    const events = [
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked(),
      questionAbandoned(),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
    ];

    const result = contextFor(events, 'plan', {
      kind: 'restart',
      of: cycleIdOf(1),
    });

    expect(result.priorQuestions).toEqual([
      { question: 'Which table owns the lease?' },
    ]);
  });

  it('carries the answer given after the question was abandoned', () => {
    const events = [
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked(),
      questionAbandoned(),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
      questionAnswered(),
    ];

    const result = contextFor(events, 'plan', {
      kind: 'restart',
      of: cycleIdOf(1),
    });

    expect(result.priorQuestions).toEqual([
      {
        question: 'Which table owns the lease?',
        answer: 'The orders table owns it.',
      },
    ]);
  });
});

describe('resolveCycleContext on a state that is not built here', () => {
  it('refuses a station the Line does not have', () => {
    const state: WorkOrderState = stateOf([created()]);

    expect(() =>
      resolveCycleContext(state, stationOf('deploy'), { kind: 'first' }),
    ).toThrow('station deploy is not in line factory-default');
  });
});
