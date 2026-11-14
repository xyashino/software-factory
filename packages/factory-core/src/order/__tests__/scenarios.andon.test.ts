import { describe, expect, it } from 'vitest';
import type { AndonReason } from '../events';
import type { CycleId } from '../../ids';
import type { LineSnapshot } from '../../line/snapshot';
import {
  blobOf,
  commitOf,
  created,
  pinnedLineOf,
  prStateChanged,
  stationOf,
} from '../../testing/event-builders';
import { actors, given, type Scenario } from '../../testing/harness';
import { lineBuilder } from '../../testing/line-builder';
import { resolveCycleContext } from '../context';
import { nextJob } from '../next-job';
import { deliveredEvents, deliveringEvents } from './histories';
import {
  answerQuestion,
  askQuestion,
  beginJob,
  blockCycle,
  blockOperator,
  causeOf,
  claim,
  completeCycle,
  expireLease,
  failCycle,
  failOperator,
  handOverCycle,
  handoverCause,
  inspect,
  judge,
  leaveNote,
  operatorJob,
  passOperator,
  raiseAndon,
  releaseJob,
  reopen,
  reportDeliveryFailed,
  reportWorkspaceFailed,
  resume,
  resumeCause,
  restartCause,
  submitVerdict,
} from '../../testing/steps';

// New v2 scenarios: the Andon, the Supervisor's resume and reopen, lost and handed-over Cycles,
// budget exhaustion, and questions that a block abandons and an answer makes visible again.

const supervisor = actors.supervisor();

/** The Andon reasons, each with a way to reach it from a fresh Work order. */
interface AndonCase {
  reason: AndonReason;
  start: () => Scenario;
  drive: (scenario: Scenario) => void;
  /** The Station the resumed Work order runs next, or `deliver`. */
  next: { stationId: string } | { deliver: true };
}

const noRetryLine: LineSnapshot = lineBuilder()
  .operator('plan', { verdict: true })
  .operator('build')
  .build();

const andonCases: AndonCase[] = [
  {
    reason: 'cycle_blocked',
    start: () => given([created()]),
    drive: (s) => {
      passOperator(s, 2);
      blockOperator(s);
    },
    next: { stationId: 'build' },
  },
  {
    reason: 'retries_exhausted',
    start: () => given([created()]),
    drive: (s) => {
      passOperator(s, 2);
      passOperator(s, 4);
      judge(s, true, 5);
      inspect(s, false);
      passOperator(s, 6);
      judge(s, true, 7);
      inspect(s, false);
    },
    next: { stationId: 'build' },
  },
  {
    reason: 'no_retry',
    start: () => given([created({ line: pinnedLineOf(noRetryLine) })]),
    drive: (s) => {
      judge(s, false);
    },
    next: { stationId: 'plan' },
  },
  {
    reason: 'restart_failed',
    start: () => given([created()]),
    drive: (s) => {
      passOperator(s, 2);
      failOperator(s, 'crashed');
      failOperator(s, 'crashed');
    },
    next: { stationId: 'build' },
  },
  {
    reason: 'workspace_failed',
    start: () => given([created()]),
    drive: (s) => {
      s.when(claim()).apply();
      s.when(reportWorkspaceFailed(), actors.cell(1)).apply();
      s.when(claim()).apply();
      s.when(reportWorkspaceFailed(), actors.cell(1)).apply();
    },
    next: { stationId: 'plan' },
  },
  {
    reason: 'delivery_failed',
    start: () => given(deliveringEvents()),
    drive: (s) => {
      s.when(claim()).apply();
      s.when(reportDeliveryFailed(), actors.cell(1)).apply();
    },
    next: { deliver: true },
  },
];

describe('the Supervisor resumes an Andon with retry_station', () => {
  it.each(andonCases.map((testCase) => [testCase.reason, testCase]))(
    'resumes a %s Andon and runs the next job without raising it again',
    (_reason, testCase) => {
      const s = testCase.start();
      testCase.drive(s);
      raiseAndon(s);
      expect(s.state()?.andon?.reason).toBe(testCase.reason);

      const resumed = s
        .when(resume({ kind: 'retry_station' }), supervisor)
        .thenTypes(['resumed'])
        .apply();

      expect(s.state()?.andon).toBeUndefined();
      const next = nextJob(resumed.state() ?? missingState());
      expect(next.kind).toBe('job');
      if ('deliver' in testCase.next) {
        expect(next).toMatchObject({ job: { kind: 'deliver' } });
      } else {
        expect(next).toMatchObject({
          job: { stationId: stationOf(testCase.next.stationId) },
        });
      }
    },
  );

  it('grants one retry by default when retries are exhausted', () => {
    const s = given([created()]);
    passOperator(s, 2);
    passOperator(s, 4);
    judge(s, true, 5);
    inspect(s, false);
    passOperator(s, 6);
    judge(s, true, 7);
    inspect(s, false);
    raiseAndon(s);

    const resumed = s.when(resume(), supervisor).apply();

    expect(resumed.state()?.retryGrants[stationOf('check')]).toBe(1);
  });

  it('refuses a resume that grants zero retries', () => {
    const s = given([created()]);
    passOperator(s, 2);
    blockOperator(s);
    raiseAndon(s);

    s.when(
      resume({ kind: 'retry_station' }, { grantRetries: 0 }),
      supervisor,
    ).thenError('invalid');
  });

  it('refuses a resume when no Andon is raised', () => {
    given([created()]).when(resume(), supervisor).thenError('precondition');
  });

  it('refuses a resume of a cancelled Work order, even with an Andon still raised', () => {
    const s = given([created()]);
    passOperator(s, 2);
    blockOperator(s);
    raiseAndon(s);
    s.when(
      { type: 'Cancel', reason: 'superseded by a newer todo' },
      supervisor,
    ).apply();

    s.when(resume(), supervisor).thenError('precondition');
  });

  it('refuses a resume by a Factory actor', () => {
    const s = given([created()]);
    passOperator(s, 2);
    blockOperator(s);
    raiseAndon(s);

    s.when(resume(), actors.factory).thenError('precondition');
  });
});

describe('the Supervisor restarts from an earlier Station', () => {
  it('restarts from plan after a blocked Cycle, trimming what plan passed', () => {
    const s = given([created()]);
    passOperator(s, 2);
    blockOperator(s);
    raiseAndon(s);

    const resumed = s
      .when(
        resume({ kind: 'restart_from', stationId: stationOf('plan') }),
        supervisor,
      )
      .thenTypes(['resumed'])
      .apply();

    expect(resumed.state()?.phase).toEqual({ kind: 'stations', index: 0 });
    expect(resumed.state()?.lastPassed[stationOf('plan')]).toBeUndefined();
    const resumeId = resumed.state()?.pendingResume?.resumeId;
    if (!resumeId) throw new Error('no pending resume');
    resumed.nextJob(
      operatorJob('plan', 2, resumeCause(resumeId), 'branch_base'),
    );
  });

  it('restarts from build after a failed Cycle, keeping what plan passed', () => {
    const s = given([created()]);
    passOperator(s, 2);
    failOperator(s, 'crashed');
    failOperator(s, 'crashed');
    raiseAndon(s);

    const resumed = s
      .when(
        resume({ kind: 'restart_from', stationId: stationOf('build') }),
        supervisor,
      )
      .thenTypes(['resumed'])
      .apply();

    expect(resumed.state()?.lastPassed[stationOf('plan')]).toBeDefined();
    const resumeId = resumed.state()?.pendingResume?.resumeId;
    if (!resumeId) throw new Error('no pending resume');
    resumed.nextJob(
      operatorJob('build', 3, resumeCause(resumeId), commitOf(2)),
    );
  });

  it('refuses a restart from a Station after the one the Work order stopped at', () => {
    // A restart moves the Work order back; one ahead would skip Stations that never passed, and
    // delivery would then have no checkpoint (CORE §4.3 rule 8).
    const s = given([created()]);
    passOperator(s, 2);
    blockOperator(s);
    raiseAndon(s);

    s.when(
      resume({ kind: 'restart_from', stationId: stationOf('audit') }),
      supervisor,
    ).thenError('precondition');
  });

  it('refuses a restart from a Station that is not in the Line', () => {
    const s = given([created()]);
    passOperator(s, 2);
    blockOperator(s);
    raiseAndon(s);

    s.when(
      resume({ kind: 'restart_from', stationId: stationOf('nowhere') }),
      supervisor,
    ).thenError('precondition');
  });
});

describe('the Supervisor reopens a delivered Work order', () => {
  it('reopens build on top of the delivered commit', () => {
    const s = given(deliveredEvents());

    const reopened = s
      .when(reopen(stationOf('build')), supervisor)
      .thenTypes(['reopened'])
      .apply();

    const resumeId = reopened.state()?.pendingResume?.resumeId;
    if (!resumeId) throw new Error('no pending resume');
    reopened.nextJob(
      operatorJob('build', 2, resumeCause(resumeId), commitOf(6)),
    );
  });

  it('refuses a reopen once the PR is merged', () => {
    given([...deliveredEvents(), prStateChanged({ state: 'merged' })])
      .when(reopen(stationOf('build')), supervisor)
      .thenError('precondition');
  });

  it('refuses a reopen at a Station that is not in the Line', () => {
    given(deliveredEvents())
      .when(reopen(stationOf('nowhere')), supervisor)
      .thenError('precondition');
  });

  it('refuses a reopen of a Work order that was not delivered', () => {
    given(deliveringEvents())
      .when(reopen(stationOf('build')), supervisor)
      .thenError('precondition');
  });
});

describe('a lost Cycle restarts, and each budget runs out on its own', () => {
  it('restarts from the base of a lost Cycle', () => {
    const s = given([created()]);
    passOperator(s, 2);
    const { started, cycle } = beginJob(s);

    const lost = started
      .and(expireLease(), actors.factory)
      .thenTypes(['cycle_failed', 'job_lost'])
      .apply();

    lost.nextJob(operatorJob('build', 2, restartCause(cycle), commitOf(2)));
  });

  it('spends the lost budget once per lost restart', () => {
    const s = given([created()]);
    passOperator(s, 2);
    const { started } = beginJob(s);
    started.and(expireLease(), actors.factory).apply();
    expect(s.state()?.lostRestartsUsed[stationOf('build')]).toBe(0);

    beginJob(s).started.apply();
    expect(s.state()?.lostRestartsUsed[stationOf('build')]).toBe(1);
  });

  it('exhausts the lost budget into a restart_failed Andon', () => {
    const line = lineBuilder()
      .operator('plan', { artifacts: ['plan'] })
      .operator('build', { maxLostRestarts: 1 })
      .build();
    const s = given([created({ line: pinnedLineOf(line) })]);
    passOperator(s, 2);
    beginJob(s).started.and(expireLease(), actors.factory).apply();
    beginJob(s).started.and(expireLease(), actors.factory).apply();

    s.nextJob(andonOf('restart_failed'));
  });

  it('keeps the lost budget apart from the crash budget', () => {
    const s = given([created()]);
    passOperator(s, 2);
    failOperator(s, 'crashed');
    const restart = beginJob(s);
    const lost = restart.started.and(expireLease(), actors.factory).apply();

    lost.nextJob(
      operatorJob('build', 3, restartCause(restart.cycle), commitOf(2)),
    );
  });

  it('hands over a Cycle and continues from its WIP commit', () => {
    const s = given([created()]);
    passOperator(s, 2);
    const { started, cycle } = beginJob(s);

    const handed = started
      .and(handOverCycle(cycle, commitOf(9)), actors.cell(1))
      .thenTypes(['cycle_handed_over'])
      .apply();

    handed.nextJob(operatorJob('build', 2, handoverCause(cycle), commitOf(9)));
    const next = nextJob(handed.state() ?? missingState());
    if (next.kind !== 'job') throw new Error('expected a job after a handover');
    const context = resolveCycleContext(
      handed.state() ?? missingState(),
      stationOf('build'),
      causeOf(next),
    );
    expect(context.handover).toEqual({
      fromCycle: cycle,
      handoverBlob: blobOf(4),
    });
  });

  it('exhausts the handover budget into a restart_failed Andon', () => {
    const line = lineBuilder()
      .operator('plan', { artifacts: ['plan'] })
      .operator('build', { maxLostRestarts: 1 })
      .build();
    const s = given([created({ line: pinnedLineOf(line) })]);
    passOperator(s, 2);
    const first = beginJob(s);
    first.started
      .and(handOverCycle(first.cycle, commitOf(9)), actors.cell(1))
      .apply();
    const second = beginJob(s);
    second.started
      .and(handOverCycle(second.cycle, commitOf(10)), actors.cell(1))
      .apply();

    s.nextJob(andonOf('restart_failed'));
  });
});

describe('a question survives a block and reaches the resumed Cycle', () => {
  it('abandons on block, is answered, and shows in the resumed context', () => {
    const s = given([created()]);
    passOperator(s, 2);
    const { started, cycle } = beginJob(s);
    const asked = started
      .and(askQuestion(cycle), actors.operator(cycle))
      .apply();
    const questionId = asked.state()?.questions[0]?.questionId;
    if (!questionId) throw new Error('the question was not recorded');

    asked
      .and(blockCycle(cycle), actors.operator(cycle))
      .thenTypes(['question_abandoned', 'cycle_blocked'])
      .apply();
    raiseAndon(s);

    s.when(answerQuestion(questionId), supervisor)
      .thenTypes(['question_answered'])
      .apply();
    const resumed = s.when(resume(), supervisor).thenTypes(['resumed']).apply();

    const next = nextJob(resumed.state() ?? missingState());
    if (next.kind !== 'job') throw new Error('expected the resumed job');
    const context = resolveCycleContext(
      resumed.state() ?? missingState(),
      stationOf('build'),
      causeOf(next),
    );
    expect(context.priorQuestions).toEqual([
      {
        question: 'Which table owns the lease?',
        answer: 'The orders table owns it.',
      },
    ]);
  });

  // Every command that ends a Cycle abandons its open question (CORE §5.2), each by the actor it needs.
  it.each([
    [
      'CompleteCycle',
      (cycle: CycleId) => completeCycle(cycle, commitOf(4)),
      (cycle: CycleId) => actors.operator(cycle),
    ],
    [
      'FailCycle',
      (cycle: CycleId) => failCycle(cycle, 'crashed'),
      () => actors.cell(1),
    ],
    [
      'BlockCycle',
      (cycle: CycleId) => blockCycle(cycle),
      (cycle: CycleId) => actors.operator(cycle),
    ],
    [
      'HandOverCycle',
      (cycle: CycleId) => handOverCycle(cycle),
      () => actors.cell(1),
    ],
    ['ReleaseJob', () => releaseJob(), () => actors.cell(1)],
    ['ExpireLease', () => expireLease(), () => actors.factory],
  ] as const)(
    'abandons the open question when %s ends the Cycle',
    (_name, command, actorOf) => {
      const s = given([created()]);
      passOperator(s, 2);
      const { started, cycle } = beginJob(s);
      const asked = started
        .and(askQuestion(cycle), actors.operator(cycle))
        .apply();

      const ended = asked.and(command(cycle), actorOf(cycle));

      expect(ended.events().map((event) => event.type)).toContain(
        'question_abandoned',
      );
    },
  );

  it('abandons the open question when a verdict ends the Cycle', () => {
    const s = given([created()]);
    passOperator(s, 2);
    passOperator(s, 4);
    const { started, cycle } = beginJob(s);
    const asked = started
      .and(askQuestion(cycle), actors.operator(cycle))
      .apply();

    const verdict = asked.and(
      submitVerdict(cycle, true),
      actors.operator(cycle),
    );

    expect(verdict.events().map((event) => event.type)).toContain(
      'question_abandoned',
    );
  });

  it('abandons the open question when the Work order is cancelled', () => {
    const s = given([created()]);
    passOperator(s, 2);
    const { started, cycle } = beginJob(s);
    const asked = started
      .and(askQuestion(cycle), actors.operator(cycle))
      .apply();

    const cancelled = asked.and(
      { type: 'Cancel', reason: 'superseded by a newer todo' },
      supervisor,
    );

    expect(cancelled.events().map((event) => event.type)).toContain(
      'question_abandoned',
    );
  });

  it('keeps a note for a later Station out of the blocked Cycle', () => {
    const s = given([created()]);
    passOperator(s, 2);
    const { started, cycle } = beginJob(s);
    started
      .and(leaveNote(cycle, stationOf('audit')), actors.operator(cycle))
      .thenTypes(['note_left']);
  });
});

/** Shorthand for `nextJob` expectations in this file. */
const andonOf = (reason: AndonReason) => ({
  kind: 'raise_andon' as const,
  reason,
});

const missingState = (): never => {
  throw new Error('the Work order has no state yet');
};
