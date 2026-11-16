import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import type { OrderCommand } from '../commands';
import { evolve } from '../evolve';
import { nextJob } from '../next-job';
import {
  andonRaised,
  blockedPrReported,
  cellIdOf,
  contextOf,
  created,
  incidentRecorded,
  jobIdOf,
} from './builders';
import { claim, stateOf } from './histories';

const CELL = { kind: 'cell', cellId: cellIdOf(1) } as const;
const SUPERVISOR = { kind: 'supervisor', name: 'dev' } as const;

const report = (
  result: Extract<OrderCommand, { type: 'ReportBlockedPr' }>['result'],
): OrderCommand => ({ type: 'ReportBlockedPr', result });

/** An escalated Andon with its blocked publish claimed as job 1 (epoch 1). */
const publishing = () =>
  stateOf([
    created(),
    andonRaised(),
    incidentRecorded({ andonAt: 2000, action: { kind: 'escalate' } }),
    claim(1, 'publish_blocked'),
  ]);

describe('ReportBlockedPr', () => {
  it('records a published draft PR for the open Andon, from the publish job', () => {
    const state = publishing();
    const result = decide(
      state,
      report({
        status: 'published',
        prUrl: 'https://github.com/acme/app/pull/7',
        commit: '0'.repeat(40) as never,
      }),
      contextOf(CELL, { epoch: 1 }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: [
        {
          type: 'blocked_pr_reported',
          jobId: jobIdOf(1),
          andonAt: 2000,
          result: { status: 'published' },
        },
      ],
    });
  });

  it('refuses a stale epoch', () => {
    const result = decide(
      publishing(),
      report({ status: 'no_changes' }),
      contextOf(CELL, { epoch: 9 }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('stale_epoch');
  });

  it('refuses a report from a job that is not a blocked publish', () => {
    const state = stateOf([created(), andonRaised(), claim(1, 'mechanic')]);

    const result = decide(
      state,
      report({ status: 'no_changes' }),
      contextOf(CELL, { epoch: 1 }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the job is not a blocked publish',
      },
    });
  });

  it('leaves the Andon and the phase as they were', () => {
    const state = publishing();
    const after = stateOf([
      created(),
      andonRaised(),
      incidentRecorded({ andonAt: 2000, action: { kind: 'escalate' } }),
      claim(1, 'publish_blocked'),
      blockedPrReported({
        jobId: jobIdOf(1),
        andonAt: 2000,
        result: { status: 'failed', detail: 'push refused' },
      }),
    ]);

    expect(after.andon).toEqual(state.andon);
    expect(after.phase).toEqual(state.phase);
    expect(after.activeJob).toBeUndefined();
    expect(after.blockedPr).toMatchObject({
      andonAt: 2000,
      result: { status: 'failed', detail: 'push refused' },
    });
    expect(nextJob(after)).toEqual({
      kind: 'await_supervisor',
      cause: 'andon',
    });
  });

  it('is applied by evolve only to the job that holds the Work order', () => {
    const state = publishing();
    const stray = blockedPrReported({ jobId: jobIdOf(5), andonAt: 2000 });
    const next = evolve(state, {
      schemaVersion: 2,
      seq: 9,
      globalSeq: 9,
      orderId: state.orderId,
      at: 9000,
      actor: CELL,
      commandId: 'x',
      event: stray,
    });
    expect(next).toEqual(state);
  });

  it('refuses a supervisor resume while the blocked publish is still running', () => {
    const result = decide(
      publishing(),
      { type: 'Resume', mode: { kind: 'retry_station' } },
      contextOf(SUPERVISOR),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the blocked PR is still being published',
      },
    });
  });
});
