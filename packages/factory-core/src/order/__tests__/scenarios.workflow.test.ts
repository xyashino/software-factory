import { describe, expect, it } from 'vitest';
import { commitOf, created, pinnedLineOf } from '../../testing/event-builders';
import { actors, given } from '../../testing/harness';
import { lineBuilder } from '../../testing/line-builder';
import {
  andon,
  claim,
  deliverJob,
  failOperator,
  firstCause,
  inspect,
  inspectionJob,
  judge,
  lastCycleOf,
  operatorJob,
  passOperator,
  raiseAndon,
  reportDelivered,
  resume,
  resumeCause,
  restartCause,
  retryCause,
} from './steps';

// The feature workflow of v1 on v2 events. The v2 default Line is plan, build, audit (a verdict
// that retries build) and check (an Inspection that retries build). v1 ran its gate before the
// audit; the v2 check runs after it, so the reruns below read build, audit, check.

const countOf = (
  cycles: { stationId: string }[] | undefined,
  station: string,
): number => cycles?.filter((cycle) => cycle.stationId === station).length ?? 0;

describe('the feature workflow on v2 events', () => {
  it('delivers after every step passes once, in order', () => {
    // v1: "delivers after every step passes once, in order"
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
    inspect(s, true).nextJob(deliverJob(commitOf(5)));
    s.when(claim())
      .thenTypes(['job_claimed'])
      .and(reportDelivered(commitOf(6)), actors.worker(1))
      .nextJob({ kind: 'done' });
  });

  it('re-plans after a plan review rejection, then builds once the review passes', () => {
    // v1: "re-plans after a plan review rejection, then builds once the review passes"
    const line = lineBuilder()
      .operator('plan', { verdict: true, onFail: { retry: 'plan', max: 2 } })
      .operator('build')
      .build();
    const s = given([created({ line: pinnedLineOf(line) })]);

    s.nextJob(operatorJob('plan', 1, firstCause, 'branch_base'));
    judge(s, false).thenTypes(['verdict_recorded']);
    s.nextJob(
      operatorJob('plan', 2, retryCause(lastCycleOf(s)), 'branch_base'),
    );
    judge(s, true, 2).nextJob(operatorJob('build', 1, firstCause, commitOf(2)));
  });

  it('gives the worker a fresh attempt with gate failures after a red gate, then audits', () => {
    // v1: "gives the worker a fresh attempt with gate failures after a red gate, then audits"
    const s = given([created()]);
    passOperator(s, 2);
    passOperator(s, 4);
    judge(s, true, 5);
    inspect(s, false);

    s.nextJob(operatorJob('build', 2, retryCause(lastCycleOf(s)), commitOf(5)));
    passOperator(s, 6).nextJob(
      operatorJob('audit', 2, firstCause, commitOf(6)),
    );
  });

  it('reruns the build and the audit after an audit rejection, then checks and delivers', () => {
    // v1: "reruns the build and the gate after an audit rejection, then delivers"
    const s = given([created()]);
    passOperator(s, 2);
    passOperator(s, 4);
    judge(s, false);

    s.nextJob(operatorJob('build', 2, retryCause(lastCycleOf(s)), commitOf(4)));
    passOperator(s, 6).nextJob(
      operatorJob('audit', 2, firstCause, commitOf(6)),
    );
    judge(s, true, 7).nextJob(
      inspectionJob('check', 1, firstCause, commitOf(7)),
    );
    inspect(s, true).nextJob(deliverJob(commitOf(7)));
  });

  it('blocks with retries_exhausted when every gate run is red, after four builds', () => {
    // v1: "blocks with retries_exhausted when every gate run is red, after four builds"
    // The check allows three retries here (onFail.max 3), so four builds run in all.
    const line = lineBuilder()
      .operator('plan')
      .operator('build')
      .operator('audit', { verdict: true, onFail: { retry: 'build', max: 2 } })
      .inspection('check', { onFail: { retry: 'build', max: 3 } })
      .build();
    const s = given([created({ line: pinnedLineOf(line) })]);
    passOperator(s, 2);
    passOperator(s, 4);
    judge(s, true, 5);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      inspect(s, false);
      passOperator(s, 10 + attempt);
      judge(s, true, 20 + attempt);
    }
    inspect(s, false).nextJob(andon('retries_exhausted'));

    expect(countOf(s.state()?.cycles, 'build')).toBe(4);
  });

  it('blocks with retries_exhausted when the audit keeps rejecting, after three builds', () => {
    // v1: "blocks with retries_exhausted when the audit keeps rejecting, after three builds"
    const s = given([created()]);
    passOperator(s, 2);
    passOperator(s, 4);
    judge(s, false);
    passOperator(s, 6);
    judge(s, false);
    passOperator(s, 8);
    judge(s, false).nextJob(andon('retries_exhausted'));

    expect(countOf(s.state()?.cycles, 'build')).toBe(3);
  });

  it('restarts a crashed build from its snapshot and delivers', () => {
    // v1: "restarts a crashed build from its snapshot and delivers"
    const s = given([created()]);
    passOperator(s, 2);
    failOperator(s, 'crashed');

    s.nextJob(
      operatorJob('build', 2, restartCause(lastCycleOf(s)), commitOf(2)),
    );
    passOperator(s, 4);
    judge(s, true, 5);
    inspect(s, true).nextJob(deliverJob(commitOf(5)));
  });

  it('blocks with infra when the restarted build crashes again', () => {
    // v1: "blocks with infra when the restarted build crashes again"
    const s = given([created()]);
    passOperator(s, 2);
    failOperator(s, 'crashed');
    failOperator(s, 'crashed').nextJob(andon('restart_failed'));

    expect(countOf(s.state()?.cycles, 'build')).toBe(2);
  });

  it('starts one more restart after a human unblocks an infra block', () => {
    // v1: "starts one more restart after a human unblocks an infra block"
    // v2: the Supervisor's resume runs the build once more as a resumed Cycle, not a restart.
    const s = given([created()]);
    passOperator(s, 2);
    failOperator(s, 'crashed');
    failOperator(s, 'crashed');
    raiseAndon(s);

    const failed = lastCycleOf(s);
    const resumed = s.when(resume(), actors.supervisor());
    const resumeId = resumed.state()?.pendingResume?.resumeId;
    if (!resumeId) throw new Error('the resume set no pending resume');
    resumed
      .thenTypes(['resumed'])
      .nextJob(
        operatorJob('build', 3, resumeCause(resumeId, failed), commitOf(2)),
      );
  });

  it('blocks again once the human extra start is used up', () => {
    // v1: "blocks again once the human extra start is used up"
    const s = given([created()]);
    passOperator(s, 2);
    failOperator(s, 'crashed');
    failOperator(s, 'crashed');
    raiseAndon(s);
    s.when(resume(), actors.supervisor()).apply();

    failOperator(s, 'crashed');
    failOperator(s, 'crashed').nextJob(andon('restart_failed'));
  });

  it('gives the same events and actions on every run', () => {
    // v1: "gives the same events and actions on every run"
    const run = () => {
      const s = given([created()]);
      passOperator(s, 2);
      passOperator(s, 4);
      judge(s, false);
      return s;
    };
    const first = run();
    const second = run();

    expect(second.state()).toEqual(first.state());
    second.nextJob(
      operatorJob('build', 2, retryCause(lastCycleOf(first)), commitOf(4)),
    );
  });
});
