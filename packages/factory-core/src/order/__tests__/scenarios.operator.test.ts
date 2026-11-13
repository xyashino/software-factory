import { describe, expect, it } from 'vitest';
import {
  commitOf,
  created,
  pinnedLineOf,
  stationOf,
} from '../../testing/event-builders';
import { actors, given } from '../../testing/harness';
import { lineBuilder } from '../../testing/line-builder';
import {
  andon,
  askQuestion,
  beginJob,
  deliverJob,
  firstCause,
  inspect,
  inspectionJob,
  judge,
  lastCycleOf,
  operatorJob,
  passOperator,
  raiseAndon,
  resume,
  retryCause,
} from '../../testing/steps';

// The v1 on-call operator. v2 has no operator Station that takes over an incident: the Supervisor
// resumes an Andon, and a Cycle asks the Supervisor a question. The ports below keep each v1 claim
// on the v2 path. The three scenarios with no v2 counterpart are listed, with reasons, in
// scenarios.checklist.test.ts.

describe('the Supervisor and the Andon, on v2 events', () => {
  it('never raises an Andon on the happy path of the default line', () => {
    // v1: "never runs on the happy path of the %s workflow"
    const s = given([created()]);
    s.nextJob(operatorJob('plan', 1, firstCause, 'branch_base'));
    passOperator(s, 2).nextJob(
      operatorJob('build', 1, firstCause, commitOf(2)),
    );
    passOperator(s, 4).nextJob(
      operatorJob('audit', 1, firstCause, commitOf(4)),
    );
    judge(s, true, 5).nextJob(
      inspectionJob('check', 1, firstCause, commitOf(5)),
    );
  });

  it('never raises an Andon on the happy path of a two-station line', () => {
    // v1: "never runs on the happy path of the %s workflow"
    const line = lineBuilder().operator('plan').operator('build').build();
    const s = given([created({ line: pinnedLineOf(line) })]);
    passOperator(s, 2).nextJob(
      operatorJob('build', 1, firstCause, commitOf(2)),
    );
    passOperator(s, 4).nextJob(deliverJob(commitOf(4)));
  });

  it('grants one extra retry, then hands the second exhaustion back to the Supervisor', () => {
    // v1: "grants one extra retry, then hands the second exhaustion to a human"
    const s = given([created()]);
    passOperator(s, 2);
    passOperator(s, 4);
    judge(s, true, 5);
    inspect(s, false);
    passOperator(s, 6);
    judge(s, true, 7);
    inspect(s, false).nextJob(andon('retries_exhausted'));
    raiseAndon(s);

    const exhausted = lastCycleOf(s);
    const resumed = s
      .when(resume(), actors.supervisor())
      .thenTypes(['resumed'])
      .apply();
    expect(resumed.state()?.retryGrants[stationOf('check')]).toBe(1);
    resumed.nextJob(
      operatorJob('build', 3, retryCause(exhausted), commitOf(7)),
    );

    passOperator(s, 8);
    judge(s, true, 9);
    inspect(s, false).nextJob(andon('retries_exhausted'));
  });

  it('never starts a second job while a question for the Supervisor is open', () => {
    // v1: "never starts the operator for a question a worker asked a human"
    const s = given([created()]);
    passOperator(s, 2);
    const { started, cycle } = beginJob(s);

    started
      .and(askQuestion(cycle), actors.operator(cycle))
      .thenTypes(['question_asked'])
      .nextJob({ kind: 'busy' });
  });

  it('refuses a second question while the first one is open', () => {
    // v1: "never starts the operator for a question a worker asked a human"
    const s = given([created()]);
    passOperator(s, 2);
    const { started, cycle } = beginJob(s);
    started
      .and(askQuestion(cycle), actors.operator(cycle))
      .apply()
      .and(askQuestion(cycle, 'Which index?'), actors.operator(cycle))
      .thenError('precondition');
  });
});
