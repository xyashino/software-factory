import { describe, expect, it } from 'vitest';
import type { Station } from '../../line/snapshot';
import { makeLine, pinnedLineOf } from './builders';
import {
  andonRaised,
  blobOf,
  cancelled,
  commitOf,
  created,
  cycleBlocked,
  cycleFailed,
  cycleHandedOver,
  cycleIdOf,
  deliveryFailed,
  inspectionFinished,
  jobIdOf,
  resumed,
  resumeIdOf,
  stationOf,
  verdictRecorded,
  workspaceFailed,
} from './builders';
import {
  begun,
  claim,
  deliveredEvents,
  deliveringEvents,
  passedStation,
  start,
  stateOf,
} from './histories';
import type { OrderEvent } from '../events';
import type { Next } from '../next';
import { nextJob } from '../next-job';
import type { WorkOrderState } from '../state';

const op = (id: string, extra: Partial<Station> = {}): Station => ({
  id: stationOf(id),
  kind: 'operator',
  requires: [],
  maxRestarts: 1,
  maxLostRestarts: 3,
  artifacts: [],
  ...extra,
});

const orderOn = (...stations: Station[]) =>
  created({ line: pinnedLineOf(makeLine(stations)) });

const next = (events: OrderEvent[]): Next => nextJob(stateOf(events));

const runningPlan = () => [created(), claim(1), start(1, 'plan')];

describe('nextJob rows 1-3: terminal, busy, andon', () => {
  it('row 1: a delivered Work order is done', () => {
    expect(next(deliveredEvents())).toEqual({ kind: 'done' });
  });

  it('row 1: a cancelled Work order is done', () => {
    expect(next([created(), cancelled()])).toEqual({ kind: 'done' });
  });

  it('row 2: an active job makes the Work order busy', () => {
    expect(next([created(), claim(1)])).toEqual({ kind: 'busy' });
  });

  it('row 3: a raised Andon waits for the Supervisor', () => {
    expect(next([created(), andonRaised()])).toEqual({
      kind: 'await_supervisor',
      cause: 'andon',
    });
  });

  it('row 2 wins over row 3 when both hold', () => {
    expect(next([created(), claim(1), andonRaised()])).toEqual({
      kind: 'busy',
    });
  });
});

describe('nextJob row 4: workspace failures', () => {
  it('row 4: two workspace failures raise the workspace Andon', () => {
    const events = [
      created(),
      claim(1),
      workspaceFailed({ jobId: jobIdOf(1) }),
      claim(2),
      workspaceFailed({ jobId: jobIdOf(2) }),
    ];

    expect(next(events)).toEqual({
      kind: 'raise_andon',
      reason: 'workspace_failed',
      detail: '2 consecutive workspace failures',
    });
  });

  it('row 4: one workspace failure retries the same first job', () => {
    const events = [
      created(),
      claim(1),
      workspaceFailed({ jobId: jobIdOf(1) }),
    ];

    expect(next(events)).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('plan'),
        n: 1,
        cause: { kind: 'first' },
        base: 'branch_base',
      },
    });
  });

  it('row 4 beats a pending resume', () => {
    const events = [
      ...runningPlan(),
      cycleBlocked({ cycleId: cycleIdOf(1) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({ mode: { kind: 'retry_station' } }),
      claim(2),
      workspaceFailed({ jobId: jobIdOf(2) }),
      claim(3),
      workspaceFailed({ jobId: jobIdOf(3) }),
    ];

    expect(next(events)).toEqual({
      kind: 'raise_andon',
      reason: 'workspace_failed',
      detail: '2 consecutive workspace failures',
    });
  });

  it('row 4 beats a restart after a failed Cycle', () => {
    const events = [
      ...runningPlan(),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
      claim(2),
      workspaceFailed({ jobId: jobIdOf(2) }),
      claim(3),
      workspaceFailed({ jobId: jobIdOf(3) }),
    ];

    expect(next(events)).toMatchObject({
      kind: 'raise_andon',
      reason: 'workspace_failed',
    });
  });
});

describe('nextJob row 5: pending resume', () => {
  it('row 5: resumes the blocked Cycle on its WIP commit', () => {
    const events = [
      ...runningPlan(),
      cycleBlocked({ cycleId: cycleIdOf(1), commit: commitOf(7) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({ mode: { kind: 'retry_station' } }),
    ];

    expect(next(events)).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('plan'),
        n: 2,
        cause: { kind: 'resume', of: cycleIdOf(1), resumeId: resumeIdOf(1) },
        base: commitOf(7),
      },
    });
  });

  it('row 5: restarts from an earlier Station on the branch base', () => {
    const events = [
      created(),
      ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
      ...begun(2, 'build'),
      cycleBlocked({ cycleId: cycleIdOf(2) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({ mode: { kind: 'restart_from', stationId: stationOf('plan') } }),
    ];

    expect(next(events)).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('plan'),
        n: 2,
        cause: { kind: 'resume', resumeId: resumeIdOf(1) },
        base: 'branch_base',
      },
    });
  });

  it('row 5 beats row 6: a pending resume is answered before the blocked Cycle', () => {
    const events = [
      ...runningPlan(),
      cycleBlocked({ cycleId: cycleIdOf(1) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({ mode: { kind: 'retry_station' } }),
    ];

    expect(next(events)).toMatchObject({
      kind: 'job',
      job: { cause: { kind: 'resume' } },
    });
  });

  it('row 5 beats rows 7-8: a pending resume is answered before the handed-over Cycle', () => {
    const events = [
      ...runningPlan(),
      cycleHandedOver({ cycleId: cycleIdOf(1), commit: commitOf(7) }),
      andonRaised({ reason: 'restart_failed' }),
      resumed({ mode: { kind: 'retry_station' } }),
    ];

    expect(next(events)).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('plan'),
        n: 2,
        cause: { kind: 'resume', of: cycleIdOf(1), resumeId: resumeIdOf(1) },
        base: commitOf(7),
      },
    });
  });

  it('row 5 beats rows 9-11: a pending resume is answered before a failed verdict', () => {
    const events = [
      created(),
      ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
      ...passedStation(2, 'build', 4),
      ...begun(3, 'audit'),
      verdictRecorded({
        cycleId: cycleIdOf(3),
        pass: false,
        artifacts: {},
        feedbackBlob: blobOf(4),
      }),
      andonRaised({ reason: 'retries_exhausted' }),
      resumed({
        mode: { kind: 'restart_from', stationId: stationOf('build') },
      }),
    ];

    expect(next(events)).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('build'),
        n: 2,
        cause: { kind: 'resume', resumeId: resumeIdOf(1) },
        base: commitOf(2),
      },
    });
  });
});

describe('nextJob rows 6-8: blocked and handed-over Cycles', () => {
  it('row 6: a blocked Cycle raises the blocked Andon', () => {
    const events = [...runningPlan(), cycleBlocked({ cycleId: cycleIdOf(1) })];

    expect(next(events)).toEqual({
      kind: 'raise_andon',
      reason: 'cycle_blocked',
      detail: `cycle ${cycleIdOf(1)} is blocked`,
    });
  });

  it('row 7: a handed-over Cycle continues on its WIP commit', () => {
    const events = [
      ...runningPlan(),
      cycleHandedOver({ cycleId: cycleIdOf(1), commit: commitOf(7) }),
    ];

    expect(next(events)).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('plan'),
        n: 2,
        cause: { kind: 'handover', of: cycleIdOf(1) },
        base: commitOf(7),
      },
    });
  });

  it('row 7: a handed-over Cycle without a WIP commit continues on its base', () => {
    const events = [
      ...runningPlan(),
      cycleHandedOver({ cycleId: cycleIdOf(1) }),
    ];

    expect(next(events)).toMatchObject({
      kind: 'job',
      job: { cause: { kind: 'handover', of: cycleIdOf(1) }, base: commitOf(1) },
    });
  });

  it('row 8: a spent handover budget raises the restart Andon', () => {
    const events = [
      created({
        line: pinnedLineOf(makeLine([op('plan', { maxLostRestarts: 0 })])),
      }),
      claim(1),
      start(1, 'plan'),
      cycleHandedOver({ cycleId: cycleIdOf(1) }),
    ];

    expect(next(events)).toEqual({
      kind: 'raise_andon',
      reason: 'restart_failed',
      detail: 'handover budget of plan spent',
    });
  });
});

describe('nextJob rows 9-11: judged failure', () => {
  const verdictFailed = (line: Station[]) => [
    orderOn(...line),
    ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
    ...passedStation(2, 'build', 4),
    ...begun(3, 'audit'),
    verdictRecorded({
      cycleId: cycleIdOf(3),
      pass: false,
      artifacts: {},
      feedbackBlob: blobOf(4),
    }),
  ];
  const line = [
    op('plan', { artifacts: ['plan'] }),
    op('build'),
    op('audit', {
      verdict: true,
      artifacts: ['review'],
      onFail: { retry: stationOf('build'), max: 2 },
    }),
  ];

  it('row 9: a failed verdict sends its onFail.retry Station back on the checkpoint', () => {
    expect(next(verdictFailed(line))).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('build'),
        n: 2,
        cause: { kind: 'retry', feedbackFrom: cycleIdOf(3) },
        base: commitOf(4),
      },
    });
  });

  it('row 10: a failed verdict with no onFail raises the no-retry Andon', () => {
    const events = [
      orderOn(op('audit', { verdict: true, artifacts: ['review'] })),
      claim(1),
      start(1, 'audit'),
      verdictRecorded({
        cycleId: cycleIdOf(1),
        pass: false,
        artifacts: {},
        feedbackBlob: blobOf(4),
      }),
    ];

    expect(next(events)).toEqual({
      kind: 'raise_andon',
      reason: 'no_retry',
      detail: 'audit failed and declares no retry',
    });
  });

  it('row 11: a retry budget spent at onFail.max raises the exhausted Andon', () => {
    const spent = [
      op('plan', { artifacts: ['plan'] }),
      op('build'),
      op('audit', {
        verdict: true,
        artifacts: ['review'],
        onFail: { retry: stationOf('build'), max: 0 },
      }),
    ];

    expect(next(verdictFailed(spent))).toEqual({
      kind: 'raise_andon',
      reason: 'retries_exhausted',
      detail: 'retry budget of audit spent',
    });
  });

  it('row 9: a retry grant raises the budget of the failing Station', () => {
    const granted = [
      ...verdictFailed([
        op('plan', { artifacts: ['plan'] }),
        op('build'),
        op('audit', {
          verdict: true,
          artifacts: ['review'],
          onFail: { retry: stationOf('build'), max: 0 },
        }),
      ]),
      andonRaised({ reason: 'retries_exhausted' }),
      resumed({ mode: { kind: 'retry_station' }, grantRetries: 1 }),
    ];

    expect(next(granted)).toMatchObject({
      kind: 'job',
      job: {
        stationId: stationOf('build'),
        cause: { kind: 'retry' },
        base: commitOf(4),
      },
    });
  });
});

describe('nextJob rows 12-13: infrastructure failures', () => {
  it('row 12: a timed-out Cycle restarts from its clean base', () => {
    const events = [
      ...runningPlan(),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
    ];

    expect(next(events)).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('plan'),
        n: 2,
        cause: { kind: 'restart', of: cycleIdOf(1) },
        base: commitOf(1),
      },
    });
  });

  it('row 12: a lost Cycle restarts against the lost budget', () => {
    const events = [
      ...runningPlan(),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'lost' }),
    ];

    expect(next(events)).toMatchObject({
      kind: 'job',
      job: { cause: { kind: 'restart', of: cycleIdOf(1) } },
    });
  });

  it('row 13: a spent restart budget raises the restart Andon', () => {
    const events = [
      ...runningPlan(),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
      claim(2),
      start(2, 'plan', {
        cause: { kind: 'restart', of: cycleIdOf(1) },
        count: 2,
      }),
      cycleFailed({ cycleId: cycleIdOf(2), reason: 'timed_out' }),
    ];

    expect(next(events)).toEqual({
      kind: 'raise_andon',
      reason: 'restart_failed',
      detail: 'restart budget of plan spent',
    });
  });
});

describe('nextJob row 14: delivery failure', () => {
  it('row 14: a failed delivery raises the delivery Andon', () => {
    const events = [
      ...deliveringEvents(),
      claim(5, 'deliver'),
      deliveryFailed({ jobId: jobIdOf(5) }),
    ];

    expect(next(events)).toEqual({
      kind: 'raise_andon',
      reason: 'delivery_failed',
      detail: 'push was rejected',
    });
  });
});

describe('nextJob rows 15-16: the phase', () => {
  it('row 15: a fresh Work order starts its first Station on the branch base', () => {
    expect(next([created()])).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('plan'),
        n: 1,
        cause: { kind: 'first' },
        base: 'branch_base',
      },
    });
  });

  it('row 15: the next Station starts on the checkpoint of the last pass', () => {
    const events = [
      created(),
      ...passedStation(1, 'plan', 2, { plan: blobOf(2) }),
    ];

    expect(next(events)).toEqual({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: stationOf('build'),
        n: 1,
        cause: { kind: 'first' },
        base: commitOf(2),
      },
    });
  });

  it('row 15: an Inspection Station runs as an inspection job', () => {
    const events = [
      orderOn({
        id: stationOf('check'),
        kind: 'inspection',
        requires: [],
        maxRestarts: 1,
        maxLostRestarts: 3,
        artifacts: [],
      }),
    ];

    expect(next(events)).toMatchObject({
      kind: 'job',
      job: { kind: 'run_inspection', stationId: stationOf('check') },
    });
  });

  it('row 16: all Stations passed deliver on the last checkpoint', () => {
    expect(next(deliveringEvents())).toEqual({
      kind: 'job',
      job: { kind: 'deliver', base: commitOf(5) },
    });
  });

  it('row 16: delivering without any checkpoint is an invariant break', () => {
    const inspectionOnly = [
      orderOn({
        id: stationOf('check'),
        kind: 'inspection',
        requires: [],
        maxRestarts: 1,
        maxLostRestarts: 3,
        artifacts: [],
      }),
      claim(1, 'run_inspection'),
      start(1, 'check'),
      inspectionFinished({ cycleId: cycleIdOf(1), passed: true, results: [] }),
    ];
    const state: WorkOrderState = stateOf(inspectionOnly);

    expect(state.phase.kind).toBe('delivering');
    expect(() => nextJob(state)).toThrow(
      'a delivering Work order has no checkpoint',
    );
  });
});
