import { describe, expect, it } from 'vitest';
import { evolve } from '../evolve';
import type { JobKind, OrderEvent, StoredEvent } from '../events';
import type { WorkOrderState } from '../state';
import {
  LINE,
  andonRaised,
  blobOf,
  cancelled,
  cellIdOf,
  commitOf,
  created,
  cycleBlocked,
  cycleCompleted,
  cycleFailed,
  cycleHandedOver,
  cycleIdOf,
  cycleStarted,
  deliveryFailed,
  deliveryFinished,
  fold,
  history,
  inspectionFinished,
  jobClaimed,
  jobIdOf,
  jobLost,
  makeLine,
  noteLeft,
  nudged,
  prStateChanged,
  priorityChanged,
  questionAbandoned,
  questionAnswered,
  questionAsked,
  questionIdOf,
  reopened,
  resumeIdOf,
  resumed,
  samples,
  specUpdated,
  stationOf,
  usageRecorded,
  verdictRecorded,
  workspaceFailed,
} from './builders';

type StartOver = Parameters<typeof cycleStarted>[0];

const foldEvents = (...events: OrderEvent[]): WorkOrderState =>
  fold(history(...events));

/** Claims job n for Cycle n on Cell 1 (an operator Station job unless told otherwise). */
const claim = (n: number, kind: JobKind = 'run_operator_station') =>
  jobClaimed({
    jobId: jobIdOf(n),
    cycleId: cycleIdOf(n),
    kind,
    cellId: cellIdOf(1),
    epoch: n,
  });

const claimDelivery = (n: number) =>
  jobClaimed({
    jobId: jobIdOf(n),
    kind: 'deliver',
    cellId: cellIdOf(1),
    epoch: n,
    cycleId: undefined,
  });

const start = (n: number, station: string, extra: StartOver = {}) =>
  cycleStarted({
    cycleId: cycleIdOf(n),
    jobId: jobIdOf(n),
    stationId: stationOf(station),
    n: 1,
    cause: { kind: 'first' },
    baseCommit: commitOf(n),
    ...extra,
  });

/** A Station that passed: its job, its Cycle and the completion. */
const pass = (n: number, station: string) => [
  claim(n),
  start(n, station),
  cycleCompleted({ cycleId: cycleIdOf(n), commit: commitOf(n), artifacts: {} }),
];

/** An inspection Station that passed or failed. */
const inspect = (n: number, station: string, passed: boolean) => [
  claim(n, 'run_inspection'),
  start(n, station),
  inspectionFinished({ cycleId: cycleIdOf(n), passed, results: [] }),
];

/** A verdict Station: a pass records its commit; a failure carries feedback. */
const verdict = (n: number, station: string, passed: boolean) => [
  claim(n),
  start(n, station),
  verdictRecorded(
    passed
      ? {
          cycleId: cycleIdOf(n),
          pass: true,
          artifacts: {},
          commit: commitOf(n),
        }
      : {
          cycleId: cycleIdOf(n),
          pass: false,
          artifacts: {},
          feedbackBlob: blobOf(n),
        },
  ),
];

/** A Cycle that ended with an infrastructure reason. */
const failed = (
  n: number,
  station: string,
  reason: 'timed_out' | 'lost' = 'timed_out',
  extra: StartOver = {},
) => [
  claim(n),
  start(n, station, extra),
  cycleFailed({ cycleId: cycleIdOf(n), reason }),
];

/** Every Station passed, then the delivery job claimed. */
const allPassed = () => [
  ...pass(1, 'plan'),
  ...pass(2, 'build'),
  ...verdict(3, 'audit', true),
  ...inspect(4, 'check', true),
];

const deepFreeze = (value: unknown): void => {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
};

describe('evolve: order_created', () => {
  it('starts a Work order at its first Station with nothing run', () => {
    const state = foldEvents(created());
    expect(state.phase).toEqual({ kind: 'stations', index: 0 });
    expect(state.cycles).toEqual([]);
    expect(state.epoch).toBe(0);
    expect(state.activeJob).toBeUndefined();
    expect(state.line.stations).toHaveLength(LINE.stations.length);
  });

  it('throws when a second order_created arrives for the same Work order', () => {
    expect(() => foldEvents(created(), created())).toThrow(
      /existing Work order/,
    );
  });

  it('throws when a history does not start with order_created', () => {
    expect(() => foldEvents(claim(1))).toThrow(/starts with order_created/);
  });
});

describe('evolve: spec_updated', () => {
  it('replaces the spec, priority and dependencies', () => {
    const base = samples.spec_updated.spec;
    const state = foldEvents(
      created(),
      specUpdated({ spec: { ...base, title: 'Renamed' }, priority: 'high' }),
    );
    expect(state.spec.title).toBe('Renamed');
    expect(state.priority).toBe('high');
  });

  it('replaces the pinned line when the update carries one', () => {
    const next = makeLine([LINE.stations[0]!]);
    const state = foldEvents(
      created(),
      specUpdated({
        line: {
          name: next.name,
          hash: next.hash,
          snapshotBlob: blobOf(10),
          snapshot: next,
        },
      }),
    );
    expect(state.line.stations).toHaveLength(1);
  });
});

describe('evolve: priority_changed', () => {
  it('sets the new priority', () => {
    expect(
      foldEvents(created(), priorityChanged({ priority: 'low' })).priority,
    ).toBe('low');
  });
});

describe('evolve: cancelled', () => {
  it('cancels the Work order and ends its job', () => {
    const state = foldEvents(
      created(),
      claim(1),
      cancelled({ reason: 'superseded' }),
    );
    expect(state.phase).toEqual({ kind: 'cancelled', reason: 'superseded' });
    expect(state.activeJob).toBeUndefined();
  });
});

describe('evolve: job_claimed', () => {
  it('holds the Work order on the claimed job', () => {
    const state = foldEvents(created(), claim(1));
    expect(state.activeJob).toEqual({
      jobId: jobIdOf(1),
      kind: 'run_operator_station',
      cellId: cellIdOf(1),
      epoch: 1,
      cycleId: cycleIdOf(1),
    });
  });

  it('takes the epoch of the claim as the last issued epoch', () => {
    expect(foldEvents(created(), claim(3)).epoch).toBe(3);
  });

  it('clears the resume wait', () => {
    const waiting = foldEvents(
      created(),
      resumed({ mode: { kind: 'retry_station' } }),
    );
    expect(waiting.resumedWaiting).toBe(true);
    expect(
      foldEvents(
        created(),
        resumed({ mode: { kind: 'retry_station' } }),
        claim(1),
      ).resumedWaiting,
    ).toBe(false);
  });
});

describe('evolve: job_lost', () => {
  it('frees the Work order when its job is lost', () => {
    expect(
      foldEvents(created(), claim(1), jobLost({ jobId: jobIdOf(1) })).activeJob,
    ).toBeUndefined();
  });

  it('ignores the loss of a job that is not the active one', () => {
    const state = foldEvents(
      created(),
      claim(1),
      jobLost({ jobId: jobIdOf(2) }),
    );
    expect(state.activeJob?.jobId).toBe(jobIdOf(1));
  });
});

describe('evolve: workspace_failed', () => {
  it('ends the job and records the cell that failed to prepare the workspace', () => {
    const state = foldEvents(
      created(),
      claim(1),
      workspaceFailed({ jobId: jobIdOf(1) }),
    );
    expect(state.activeJob).toBeUndefined();
    expect(state.workspaceFailures).toEqual([
      { cellId: cellIdOf(1), jobId: jobIdOf(1), at: 3000 },
    ]);
  });

  it('ignores a workspace failure of a job that is not the active one', () => {
    const state = foldEvents(
      created(),
      claim(1),
      workspaceFailed({ jobId: jobIdOf(2) }),
    );
    expect(state.activeJob?.jobId).toBe(jobIdOf(1));
    expect(state.workspaceFailures).toEqual([]);
  });
});

describe('evolve: cycle_started', () => {
  it('starts a running Cycle on the claimed job', () => {
    const state = foldEvents(created(), claim(1), start(1, 'plan'));
    expect(state.cycles).toHaveLength(1);
    expect(state.cycles[0]).toMatchObject({
      cycleId: cycleIdOf(1),
      jobId: jobIdOf(1),
      cellId: cellIdOf(1),
      stationId: 'plan',
      n: 1,
      status: 'running',
      cause: { kind: 'first' },
      startedAt: 3000,
    });
  });

  it('moves the phase to the Station the Cycle runs', () => {
    expect(foldEvents(created(), claim(1), start(1, 'build')).phase).toEqual({
      kind: 'stations',
      index: 1,
    });
  });

  it('is ignored when no job of its id is claimed', () => {
    expect(foldEvents(created(), start(1, 'plan')).cycles).toEqual([]);
  });

  it('clears the consecutive workspace failures', () => {
    const state = foldEvents(
      created(),
      claim(1),
      workspaceFailed({ jobId: jobIdOf(1) }),
      claim(2),
      start(2, 'plan'),
    );
    expect(state.workspaceFailures).toEqual([]);
  });
});

describe('evolve: cycle_completed', () => {
  it('passes the Cycle, records its commit and frees its job', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      cycleCompleted({
        cycleId: cycleIdOf(1),
        commit: commitOf(7),
        artifacts: { plan: blobOf(2) },
      }),
    );
    expect(state.cycles[0]).toMatchObject({
      status: 'passed',
      outcome: 'done',
      commit: commitOf(7),
      artifacts: { plan: blobOf(2) },
      endedAt: 4000,
    });
    expect(state.activeJob).toBeUndefined();
  });

  it('advances the phase to the next Station', () => {
    expect(foldEvents(created(), ...pass(1, 'plan')).phase).toEqual({
      kind: 'stations',
      index: 1,
    });
  });

  it('is ignored when the Cycle is no longer the live one', () => {
    const before = foldEvents(created(), ...pass(1, 'plan'));
    const after = foldEvents(
      created(),
      ...pass(1, 'plan'),
      cycleCompleted({
        cycleId: cycleIdOf(1),
        commit: commitOf(8),
        artifacts: {},
      }),
    );
    expect(after).toEqual(before);
  });
});

describe('evolve: verdict_recorded', () => {
  it('passes an audit verdict and advances to the next Station', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', true),
    );
    expect(state.lastPassed[stationOf('audit')]).toBe(cycleIdOf(3));
    expect(state.phase).toEqual({ kind: 'stations', index: 3 });
  });

  it('records a failing verdict with its feedback and does not pass the Station', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', false),
    );
    expect(state.cycles[2]).toMatchObject({
      status: 'failed',
      outcome: 'verdict_fail',
      feedbackBlob: blobOf(3),
    });
    expect(state.lastPassed[stationOf('audit')]).toBeUndefined();
    expect(state.phase).toEqual({ kind: 'stations', index: 2 });
  });

  it('leaves no retry pending when the failing Station declares no onFail', () => {
    const state = foldEvents(created(), ...verdict(1, 'plan', false));
    expect(state.pendingFeedback).toBeUndefined();
  });
});

describe('evolve: inspection_finished', () => {
  it('passes the last inspection and moves the Work order to delivery', () => {
    const state = foldEvents(created(), ...allPassed());
    expect(state.phase).toEqual({ kind: 'delivering' });
    expect(state.cycles[3]).toMatchObject({
      status: 'passed',
      outcome: 'inspection_pass',
    });
  });

  it('keeps the inspection results of the Cycle', () => {
    const results = [
      {
        command: 'pnpm test',
        exitCode: 0,
        timedOut: false,
        durationMs: 1200,
        tail: 'ok',
        logBlob: blobOf(6),
      },
    ];
    const state = foldEvents(
      created(),
      ...inspect(1, 'check', true).slice(0, 2),
      inspectionFinished({ cycleId: cycleIdOf(1), passed: true, results }),
    );
    expect(state.cycles[0]?.inspectionResults).toEqual(results);
  });

  it('asks the failing inspection Station onFail.retry for another Cycle', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', true),
      ...inspect(4, 'check', false),
    );
    expect(state.pendingFeedback).toEqual({
      forStation: stationOf('build'),
      fromCycle: cycleIdOf(4),
    });
  });
});

describe('evolve: cycle_failed', () => {
  it('ends the Cycle with its infrastructure reason and frees its job', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'lost' }),
    );
    expect(state.cycles[0]).toMatchObject({
      status: 'failed',
      outcome: 'lost',
    });
    expect(state.activeJob).toBeUndefined();
  });
});

describe('evolve: cycle_blocked', () => {
  it('blocks the Cycle with its handover and frees its job', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      cycleBlocked({ cycleId: cycleIdOf(1) }),
    );
    expect(state.cycles[0]).toMatchObject({
      status: 'blocked',
      outcome: 'blocked',
      handoverBlob: blobOf(4),
    });
    expect(state.activeJob).toBeUndefined();
  });
});

describe('evolve: cycle_handed_over', () => {
  it('hands the Cycle over with its handover and frees its job', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      cycleHandedOver({ cycleId: cycleIdOf(1), commit: commitOf(3) }),
    );
    expect(state.cycles[0]).toMatchObject({
      status: 'handed_over',
      outcome: 'handed_over',
      commit: commitOf(3),
    });
    expect(state.activeJob).toBeUndefined();
  });
});

describe('evolve: usage_recorded', () => {
  it('records the usage of a Cycle', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      usageRecorded({ cycleId: cycleIdOf(1) }),
    );
    expect(state.cycles[0]?.usage).toEqual({
      model: 'claude-sonnet-5-5',
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.02,
    });
  });

  it('ignores usage of a Cycle the history does not contain', () => {
    const before = foldEvents(created(), ...pass(1, 'plan'));
    expect(
      foldEvents(
        created(),
        ...pass(1, 'plan'),
        usageRecorded({ cycleId: cycleIdOf(9) }),
      ),
    ).toEqual(before);
  });
});

describe('evolve: question_asked', () => {
  it('asks a question on the live Cycle and pauses it', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
    );
    expect(state.questions).toEqual([
      {
        questionId: questionIdOf(1),
        cycleId: cycleIdOf(1),
        text: 'Which table owns the lease?',
        status: 'open',
        askedAt: 4000,
      },
    ]);
    expect(state.cycles[0]?.pausedSince).toBe(4000);
  });

  it('ignores a second question while one is open', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(2) }),
    );
    expect(state.questions).toHaveLength(1);
  });

  it('ignores a question about a Cycle that already ended', () => {
    const state = foldEvents(
      created(),
      ...failed(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
    );
    expect(state.questions).toEqual([]);
  });
});

describe('evolve: question_answered', () => {
  it('records the answer and resumes the paused Cycle', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
      questionAnswered({
        questionId: questionIdOf(1),
        by: 'dev',
        text: 'The orders table.',
      }),
    );
    expect(state.questions[0]).toMatchObject({
      status: 'answered',
      answer: { by: 'dev', text: 'The orders table.', at: 5000 },
    });
    expect(state.cycles[0]).toMatchObject({
      pausedMs: 1000,
      pausedSince: undefined,
    });
  });

  it('records an answer to a question of an ended Cycle without moving its pause', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
      questionAbandoned({ questionId: questionIdOf(1) }),
      questionAnswered({
        questionId: questionIdOf(1),
        by: 'dev',
        text: 'Late answer.',
      }),
    );
    expect(state.questions[0]?.status).toBe('answered');
    expect(state.cycles[0]).toMatchObject({
      pausedMs: 1000,
      pausedSince: undefined,
    });
  });

  it('ignores an answer to a question the history does not contain', () => {
    const before = foldEvents(created(), claim(1), start(1, 'plan'));
    const after = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAnswered({ questionId: questionIdOf(9), by: 'dev', text: 'x' }),
    );
    expect(after).toEqual(before);
  });
});

describe('evolve: question_abandoned', () => {
  it('abandons the open question', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
      questionAbandoned({ questionId: questionIdOf(1) }),
    );
    expect(state.questions[0]?.status).toBe('abandoned');
  });
});

describe('evolve: note_left', () => {
  it('records a note from the live Cycle with the Station it came from', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      noteLeft({
        cycleId: cycleIdOf(1),
        to: stationOf('build'),
        text: 'keep it small',
      }),
    );
    expect(state.notes).toEqual([
      {
        cycleId: cycleIdOf(1),
        fromStation: 'plan',
        to: 'build',
        text: 'keep it small',
      },
    ]);
  });

  it('ignores a note from a Cycle that already ended', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      noteLeft({ cycleId: cycleIdOf(1), to: 'supervisor', text: 'late' }),
    );
    expect(state.notes).toEqual([]);
  });
});

describe('evolve: nudged', () => {
  it('changes nothing the Factory decides on', () => {
    const before = foldEvents(created(), claim(1), start(1, 'plan'));
    expect(
      foldEvents(
        created(),
        claim(1),
        start(1, 'plan'),
        nudged({ cycleId: cycleIdOf(1) }),
      ),
    ).toEqual(before);
  });
});

describe('evolve: andon_raised', () => {
  it('raises the Andon with its reason, detail and time', () => {
    const state = foldEvents(
      created(),
      andonRaised({ reason: 'no_retry', detail: 'no retry declared' }),
    );
    expect(state.andon).toEqual({
      reason: 'no_retry',
      detail: 'no retry declared',
      at: 2000,
    });
  });
});

describe('evolve: resumed', () => {
  it('clears the Andon and marks the resume as waiting for a job', () => {
    const state = foldEvents(
      created(),
      andonRaised({ reason: 'workspace_failed' }),
      resumed({ mode: { kind: 'retry_station' } }),
    );
    expect(state.andon).toBeUndefined();
    expect(state.resumedWaiting).toBe(true);
  });
});

describe('evolve: reopened', () => {
  it('moves a delivered Work order back to a Station', () => {
    const state = foldEvents(
      created(),
      ...allPassed(),
      claimDelivery(9),
      deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
      reopened({ stationId: stationOf('build') }),
    );
    expect(state.phase).toEqual({ kind: 'stations', index: 1 });
  });
});

describe('evolve: delivery_finished', () => {
  it('delivers the Work order and records its pull request', () => {
    const state = foldEvents(
      created(),
      ...allPassed(),
      claimDelivery(9),
      deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
    );
    expect(state.phase).toEqual({ kind: 'delivered' });
    expect(state.delivery).toEqual({
      prUrl: 'https://github.com/example/software-factory/pull/42',
      commit: commitOf(9),
      state: 'open',
    });
    expect(state.activeJob).toBeUndefined();
  });
});

describe('evolve: delivery_failed', () => {
  it('records the delivery failure and frees the job', () => {
    const state = foldEvents(
      created(),
      claimDelivery(1),
      deliveryFailed({ jobId: jobIdOf(1) }),
    );
    expect(state.deliveryFailed).toEqual({
      jobId: jobIdOf(1),
      detail: 'push was rejected',
    });
    expect(state.activeJob).toBeUndefined();
  });
});

describe('evolve: pr_state_changed', () => {
  it('updates the delivery state of the delivered pull request', () => {
    const state = foldEvents(
      created(),
      ...allPassed(),
      claimDelivery(9),
      deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
      prStateChanged({ state: 'merged' }),
    );
    expect(state.delivery?.state).toBe('merged');
  });

  it('ignores a pull request that is not the delivered one', () => {
    const before = foldEvents(
      created(),
      ...allPassed(),
      claimDelivery(9),
      deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
    );
    const after = foldEvents(
      created(),
      ...allPassed(),
      claimDelivery(9),
      deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
      prStateChanged({
        prUrl: 'https://github.com/example/other/pull/1',
        state: 'closed',
      }),
    );
    expect(after).toEqual(before);
  });
});

describe('evolve rule 1: liveness guard', () => {
  it('a cycle event about an earlier Cycle changes nothing', () => {
    const base = [created(), ...pass(1, 'plan'), claim(2), start(2, 'build')];
    const before = foldEvents(...base);
    const after = foldEvents(
      ...base,
      verdictRecorded({
        cycleId: cycleIdOf(1),
        pass: false,
        artifacts: {},
        feedbackBlob: blobOf(5),
      }),
    );
    expect(after).toEqual(before);
  });

  it('a cycle event about a Cycle that already ended changes nothing', () => {
    const base = [
      created(),
      claim(1),
      start(1, 'plan'),
      cycleCompleted({
        cycleId: cycleIdOf(1),
        commit: commitOf(2),
        artifacts: {},
      }),
    ];
    const before = foldEvents(...base);
    expect(
      foldEvents(
        ...base,
        cycleFailed({ cycleId: cycleIdOf(1), reason: 'crashed' }),
      ),
    ).toEqual(before);
  });

  it('usage_recorded sets usage on an ended Cycle and nothing else', () => {
    const base = [created(), ...pass(1, 'plan')];
    const before = foldEvents(...base);
    const after = foldEvents(...base, usageRecorded({ cycleId: cycleIdOf(1) }));
    expect(after.cycles[0]?.usage?.inputTokens).toBe(1200);
    expect({ ...after, cycles: [] }).toEqual({ ...before, cycles: [] });
  });

  it('question_answered updates the record on an ended Cycle', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'stalled' }),
      questionAbandoned({ questionId: questionIdOf(1) }),
      questionAnswered({
        questionId: questionIdOf(1),
        by: 'dev',
        text: 'Too late, but recorded.',
      }),
    );
    expect(state.questions[0]?.answer?.text).toBe('Too late, but recorded.');
    expect(state.cycles[0]?.status).toBe('failed');
  });
});

describe.each([
  [
    'cycle_completed',
    [
      claim(1),
      start(1, 'plan'),
      cycleCompleted({
        cycleId: cycleIdOf(1),
        commit: commitOf(2),
        artifacts: {},
      }),
    ],
  ],
  [
    'verdict_recorded',
    [
      claim(1),
      start(1, 'plan'),
      verdictRecorded({ cycleId: cycleIdOf(1), pass: true, artifacts: {} }),
    ],
  ],
  [
    'inspection_finished',
    [
      claim(1, 'run_inspection'),
      start(1, 'check'),
      inspectionFinished({ cycleId: cycleIdOf(1), passed: true, results: [] }),
    ],
  ],
  [
    'cycle_failed',
    [
      claim(1),
      start(1, 'plan'),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
    ],
  ],
  [
    'cycle_blocked',
    [claim(1), start(1, 'plan'), cycleBlocked({ cycleId: cycleIdOf(1) })],
  ],
  [
    'cycle_handed_over',
    [claim(1), start(1, 'plan'), cycleHandedOver({ cycleId: cycleIdOf(1) })],
  ],
  ['workspace_failed', [claim(1), workspaceFailed({ jobId: jobIdOf(1) })]],
  ['job_lost', [claim(1), jobLost({ jobId: jobIdOf(1) })]],
  [
    'delivery_finished',
    [
      claimDelivery(1),
      deliveryFinished({ jobId: jobIdOf(1), commit: commitOf(2) }),
    ],
  ],
  [
    'delivery_failed',
    [claimDelivery(1), deliveryFailed({ jobId: jobIdOf(1) })],
  ],
] as [string, OrderEvent[]][])(
  'evolve rule 2: %s frees the active job',
  (_name, events) => {
    it('clears activeJob', () => {
      expect(foldEvents(created(), ...events).activeJob).toBeUndefined();
    });
  },
);

describe('evolve rule 3: a pass', () => {
  it('records the passed Cycle as the last pass of its Station', () => {
    expect(
      foldEvents(created(), ...pass(1, 'plan')).lastPassed[stationOf('plan')],
    ).toBe(cycleIdOf(1));
  });

  it('records the checkpoint of the commit it carries', () => {
    expect(foldEvents(created(), ...pass(1, 'plan')).checkpoint).toEqual({
      commit: commitOf(1),
      afterStation: 'plan',
    });
  });

  it('keeps the checkpoint when the pass carries no commit', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...inspect(2, 'build', true),
    );
    expect(state.checkpoint).toEqual({
      commit: commitOf(1),
      afterStation: 'plan',
    });
    expect(state.phase).toEqual({ kind: 'stations', index: 2 });
  });

  it('resets the failure counters of the Station and clears feedback aimed at it', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', false),
      ...failed(4, 'build', 'timed_out', {
        cause: { kind: 'restart', of: cycleIdOf(2) },
        n: 2,
      }),
      ...pass(5, 'build'),
    );
    expect(state.restartsUsed[stationOf('build')]).toBe(0);
    expect(state.lostRestartsUsed[stationOf('build')]).toBe(0);
    expect(state.pendingFeedback).toBeUndefined();
  });

  it('moves the phase to delivery past the last Station', () => {
    expect(foldEvents(created(), ...allPassed()).phase).toEqual({
      kind: 'delivering',
    });
  });
});

describe('evolve rule 4: a judged failure', () => {
  it('sets pending feedback for the onFail.retry Station', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', false),
    );
    expect(state.pendingFeedback).toEqual({
      forStation: stationOf('build'),
      fromCycle: cycleIdOf(3),
    });
  });

  it('sets no feedback when the Station declares no onFail', () => {
    expect(
      foldEvents(created(), ...verdict(1, 'plan', false)).pendingFeedback,
    ).toBeUndefined();
  });
});

describe('evolve rule 5: cycle_started by cause', () => {
  it('a retry moves the phase back and counts the retry of the failing Station', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', false),
      claim(4),
      start(4, 'build', {
        cause: { kind: 'retry', feedbackFrom: cycleIdOf(3) },
        n: 2,
      }),
    );
    expect(state.phase).toEqual({ kind: 'stations', index: 1 });
    expect(state.retriesUsed[stationOf('audit')]).toBe(1);
  });

  it('a restart of a lost Cycle counts against the lost budget', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...failed(2, 'build', 'lost'),
      claim(3),
      start(3, 'build', { cause: { kind: 'restart', of: cycleIdOf(2) }, n: 2 }),
    );
    expect(state.lostRestartsUsed[stationOf('build')]).toBe(1);
    expect(state.restartsUsed[stationOf('build')]).toBe(0);
  });

  it('a restart of a timed out Cycle counts against the restart budget', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...failed(2, 'build', 'timed_out'),
      claim(3),
      start(3, 'build', { cause: { kind: 'restart', of: cycleIdOf(2) }, n: 2 }),
    );
    expect(state.restartsUsed[stationOf('build')]).toBe(1);
    expect(state.lostRestartsUsed[stationOf('build')]).toBe(0);
  });

  it('a handover counts against the lost budget', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      claim(2),
      start(2, 'build'),
      cycleHandedOver({ cycleId: cycleIdOf(2) }),
      claim(3),
      start(3, 'build', {
        cause: { kind: 'handover', of: cycleIdOf(2) },
        n: 2,
      }),
    );
    expect(state.lostRestartsUsed[stationOf('build')]).toBe(1);
  });

  it('a resume clears the pending resume it answers', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      claim(2),
      start(2, 'build'),
      cycleBlocked({ cycleId: cycleIdOf(2) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
      claim(3),
      start(3, 'build', {
        cause: { kind: 'resume', of: cycleIdOf(2), resumeId: resumeIdOf(1) },
        n: 2,
      }),
    );
    expect(state.pendingResume).toBeUndefined();
  });
});

describe('evolve rule 6: pauses', () => {
  it('a Cycle that ends while its question is open stops the pause', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
      cycleFailed({ cycleId: cycleIdOf(1), reason: 'timed_out' }),
    );
    expect(state.cycles[0]).toMatchObject({
      pausedMs: 1000,
      pausedSince: undefined,
    });
  });

  it('paused time is excluded from the Cycle only while it is paused', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(1) }),
      questionAnswered({ questionId: questionIdOf(1), by: 'dev', text: 'yes' }),
      questionAsked({ cycleId: cycleIdOf(1), questionId: questionIdOf(2) }),
    );
    expect(state.cycles[0]).toMatchObject({
      pausedMs: 1000,
      pausedSince: 6000,
    });
  });
});

describe('evolve rule 7: resumed with retry_station', () => {
  it('a blocked Cycle resumes at its Station from that Cycle', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      claim(2),
      start(2, 'build'),
      cycleBlocked({ cycleId: cycleIdOf(2) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
    );
    expect(state.pendingResume).toEqual({
      resumeId: resumeIdOf(1),
      forStation: stationOf('build'),
      fromCycle: cycleIdOf(2),
    });
    expect(state.andon).toBeUndefined();
  });

  it('a failed Cycle with no retry resumes that Station from the failed Cycle', () => {
    const state = foldEvents(
      created(),
      ...verdict(1, 'plan', false),
      andonRaised({ reason: 'no_retry' }),
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
    );
    expect(state.pendingResume).toEqual({
      resumeId: resumeIdOf(1),
      forStation: stationOf('plan'),
      fromCycle: cycleIdOf(1),
    });
  });

  it('restart_failed resumes the Station with a fresh restart budget', () => {
    const restartFailed = [
      created(),
      ...failed(1, 'plan'),
      claim(2),
      start(2, 'plan', { cause: { kind: 'restart', of: cycleIdOf(1) }, n: 2 }),
      cycleFailed({ cycleId: cycleIdOf(2), reason: 'timed_out' }),
      andonRaised({ reason: 'restart_failed' }),
    ];
    expect(foldEvents(...restartFailed).restartsUsed[stationOf('plan')]).toBe(
      1,
    );
    const after = foldEvents(
      ...restartFailed,
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
    );
    expect(after.restartsUsed[stationOf('plan')]).toBe(0);
    expect(after.lostRestartsUsed[stationOf('plan')]).toBe(0);
    expect(after.pendingResume?.fromCycle).toBe(cycleIdOf(2));
  });

  it('retries_exhausted grants the extra retries to the failing Station', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', false),
      andonRaised({ reason: 'retries_exhausted' }),
      resumed({
        resumeId: resumeIdOf(1),
        mode: { kind: 'retry_station' },
        grantRetries: 2,
      }),
    );
    expect(state.retryGrants[stationOf('audit')]).toBe(2);
    expect(state.pendingResume).toBeUndefined();
    expect(state.andon).toBeUndefined();
  });

  it('grants retries for any other reason too', () => {
    const state = foldEvents(
      created(),
      claim(1),
      start(1, 'plan'),
      cycleBlocked({ cycleId: cycleIdOf(1) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({
        resumeId: resumeIdOf(1),
        mode: { kind: 'retry_station' },
        grantRetries: 1,
      }),
    );
    expect(state.retryGrants[stationOf('plan')]).toBe(1);
  });

  it('grants nothing when no retries are given', () => {
    const state = foldEvents(
      created(),
      ...verdict(1, 'plan', false),
      andonRaised({ reason: 'retries_exhausted' }),
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
    );
    expect(state.retryGrants[stationOf('audit')]).toBe(0);
  });

  it('a workspace failure resumes with the failures cleared and nothing pending', () => {
    const state = foldEvents(
      created(),
      claim(1),
      workspaceFailed({ jobId: jobIdOf(1) }),
      claim(2),
      workspaceFailed({ jobId: jobIdOf(2) }),
      andonRaised({ reason: 'workspace_failed' }),
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
    );
    expect(state.workspaceFailures).toEqual([]);
    expect(state.pendingResume).toBeUndefined();
    expect(state.andon).toBeUndefined();
  });

  it('a delivery failure resumes with the delivery failure cleared', () => {
    const state = foldEvents(
      created(),
      ...allPassed(),
      claimDelivery(9),
      deliveryFailed({ jobId: jobIdOf(9) }),
      andonRaised({ reason: 'delivery_failed' }),
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
    );
    expect(state.deliveryFailed).toBeUndefined();
  });
});

describe('evolve rule 8: resumed with restart_from', () => {
  const blockedAtAudit = [
    created(),
    ...pass(1, 'plan'),
    ...pass(2, 'build'),
    claim(3),
    start(3, 'audit'),
    cycleBlocked({ cycleId: cycleIdOf(3) }),
    andonRaised({ reason: 'cycle_blocked' }),
  ];

  it('moves the phase back to the Station and forgets the passes at or after it', () => {
    const state = foldEvents(
      ...blockedAtAudit,
      resumed({
        resumeId: resumeIdOf(1),
        mode: { kind: 'restart_from', stationId: stationOf('build') },
      }),
    );
    expect(state.phase).toEqual({ kind: 'stations', index: 1 });
    expect(state.lastPassed).toEqual({ plan: cycleIdOf(1) });
  });

  it('resets the checkpoint to the latest one of a Station before it', () => {
    const state = foldEvents(
      ...blockedAtAudit,
      resumed({
        resumeId: resumeIdOf(1),
        mode: { kind: 'restart_from', stationId: stationOf('build') },
      }),
    );
    expect(state.checkpoint).toEqual({
      commit: commitOf(1),
      afterStation: 'plan',
    });
  });

  it('clears the checkpoint when no Station before it has one', () => {
    const state = foldEvents(
      ...blockedAtAudit,
      resumed({
        resumeId: resumeIdOf(1),
        mode: { kind: 'restart_from', stationId: stationOf('plan') },
      }),
    );
    expect(state.checkpoint).toBeUndefined();
    expect(state.lastPassed).toEqual({});
  });

  it('keeps the lifetime retries and the Cycles of the earlier Stations', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', false),
      claim(4),
      start(4, 'build', {
        cause: { kind: 'retry', feedbackFrom: cycleIdOf(3) },
        n: 2,
      }),
      cycleCompleted({
        cycleId: cycleIdOf(4),
        commit: commitOf(4),
        artifacts: {},
      }),
      claim(5),
      start(5, 'audit'),
      cycleBlocked({ cycleId: cycleIdOf(5) }),
      andonRaised({ reason: 'cycle_blocked' }),
      resumed({
        resumeId: resumeIdOf(1),
        mode: { kind: 'restart_from', stationId: stationOf('plan') },
      }),
    );
    expect(state.retriesUsed[stationOf('audit')]).toBe(1);
    expect(state.cycles).toHaveLength(5);
  });

  it('clears the Andon, the pending feedback and the delivery failure, and asks the Station to run', () => {
    const state = foldEvents(
      created(),
      ...pass(1, 'plan'),
      ...pass(2, 'build'),
      ...verdict(3, 'audit', false),
      andonRaised({ reason: 'retries_exhausted' }),
      resumed({
        resumeId: resumeIdOf(1),
        mode: { kind: 'restart_from', stationId: stationOf('build') },
      }),
    );
    expect(state.andon).toBeUndefined();
    expect(state.pendingFeedback).toBeUndefined();
    expect(state.pendingResume).toEqual({
      resumeId: resumeIdOf(1),
      forStation: stationOf('build'),
    });
    expect(state.resumedWaiting).toBe(true);
  });
});

describe('evolve rule 9: reopened', () => {
  const delivered = () => [
    created(),
    ...allPassed(),
    claimDelivery(9),
    deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
  ];

  it('moves a delivered Work order back to the Station on top of the delivered commit', () => {
    const state = foldEvents(
      ...delivered(),
      reopened({ resumeId: resumeIdOf(2), stationId: stationOf('build') }),
    );
    expect(state.phase).toEqual({ kind: 'stations', index: 1 });
    expect(state.checkpoint).toEqual({
      commit: commitOf(9),
      afterStation: 'plan',
    });
    expect(state.pendingResume).toEqual({
      resumeId: resumeIdOf(2),
      forStation: stationOf('build'),
    });
    expect(state.lastPassed).toEqual({ plan: cycleIdOf(1) });
  });

  it('keeps the delivery and leaves no station before the first as the checkpoint', () => {
    const state = foldEvents(
      ...delivered(),
      reopened({ resumeId: resumeIdOf(2), stationId: stationOf('plan') }),
    );
    expect(state.checkpoint).toEqual({
      commit: commitOf(9),
      afterStation: null,
    });
    expect(state.delivery?.commit).toBe(commitOf(9));
  });

  it('changes nothing when the Work order was not delivered', () => {
    const before = foldEvents(created(), ...pass(1, 'plan'));
    expect(
      foldEvents(
        created(),
        ...pass(1, 'plan'),
        reopened({ resumeId: resumeIdOf(2), stationId: stationOf('build') }),
      ),
    ).toEqual(before);
  });
});

describe('evolve rule 10: workspace failures, resume waits and delivery', () => {
  it('a job claim clears the resume wait and a cycle start clears workspace failures', () => {
    const state = foldEvents(
      created(),
      resumed({ resumeId: resumeIdOf(1), mode: { kind: 'retry_station' } }),
      claim(1),
      workspaceFailed({ jobId: jobIdOf(1) }),
      claim(2),
      start(2, 'plan'),
    );
    expect(state.resumedWaiting).toBe(false);
    expect(state.workspaceFailures).toEqual([]);
  });

  it('a delivery failure is recorded until the Work order resumes', () => {
    const state = foldEvents(
      created(),
      claimDelivery(1),
      deliveryFailed({ jobId: jobIdOf(1) }),
    );
    expect(state.deliveryFailed?.jobId).toBe(jobIdOf(1));
  });

  it('a delivered pull request clears the workspace failures', () => {
    const state = foldEvents(
      created(),
      ...allPassed(),
      claimDelivery(9),
      workspaceFailed({ jobId: jobIdOf(9) }),
      claimDelivery(10),
      deliveryFinished({ jobId: jobIdOf(10), commit: commitOf(10) }),
    );
    expect(state.phase).toEqual({ kind: 'delivered' });
    expect(state.workspaceFailures).toEqual([]);
  });
});

describe('evolve purity', () => {
  it('never mutates the state it is given', () => {
    const events = history(
      created(),
      ...pass(1, 'plan'),
      claim(2),
      start(2, 'build'),
    );
    const state = fold(events.slice(0, -1));
    const snapshot = structuredClone(state);
    deepFreeze(state);
    const next = evolve(state, events[events.length - 1] as StoredEvent);
    expect(next.cycles).toHaveLength(2);
    expect(state).toEqual(snapshot);
  });

  it('folds the same events to the same state every time', () => {
    const events = history(
      created(),
      ...allPassed(),
      claimDelivery(9),
      deliveryFinished({ jobId: jobIdOf(9), commit: commitOf(9) }),
    );
    expect(fold(events)).toEqual(fold(events));
  });

  it('refuses a non-creation event as the first of a history', () => {
    const [first] = history(nudged({ cycleId: cycleIdOf(1) }));
    expect(() => evolve(undefined, first as StoredEvent)).toThrow(
      /starts with order_created/,
    );
  });
});
