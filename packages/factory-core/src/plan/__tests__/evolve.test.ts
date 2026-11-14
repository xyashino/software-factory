import { describe, expect, it } from 'vitest';
import { evolvePlan } from '../evolve';
import {
  COMMIT,
  CELL,
  JOB,
  PLAN_ID,
  PR_URL,
  RESUME,
  chainOf3,
  created,
  fold,
  member,
  orderOf,
  stored,
} from './harness';

describe('evolve: creation and members', () => {
  it('starts in branching with the branch and base of the plan', () => {
    const state = fold([created()]);
    expect(state).toMatchObject({
      planId: PLAN_ID,
      slug: 'xyz',
      branch: 'feat/xyz',
      baseBranch: 'main',
      phase: { kind: 'branching' },
      members: [],
      epoch: 0,
      failures: [],
      resumedWaiting: false,
    });
  });

  it('refuses a history that does not start with plan_created', () => {
    expect(() => evolvePlan(undefined, stored(1, member('wo-1')))).toThrow(
      /starts with plan_created/,
    );
  });

  it('refuses a second plan_created', () => {
    expect(() => fold([created(), created()])).toThrow(/existing plan/);
  });

  it('appends members in chain order, each open, and keeps the predecessor', () => {
    const state = fold(chainOf3());
    expect(state.members.map((m) => [m.todoId, m.state, m.after])).toEqual([
      ['wo-1', 'open', undefined],
      ['wo-2', 'open', orderOf('wo-1')],
      ['wo-3', 'open', orderOf('wo-2')],
    ]);
  });

  it('sets a member state, and a merged member never goes back', () => {
    const state = fold([
      ...chainOf3(),
      {
        type: 'plan_member_state_changed',
        orderId: orderOf('wo-1'),
        state: 'merged',
      },
      {
        type: 'plan_member_state_changed',
        orderId: orderOf('wo-1'),
        state: 'closed',
      },
    ]);
    expect(state.members[0]?.state).toBe('merged');
  });

  it('ignores a report for a Work order that is not a member', () => {
    const state = fold([
      ...chainOf3(),
      {
        type: 'plan_member_state_changed',
        orderId: orderOf('nope'),
        state: 'merged',
      },
    ]);
    expect(state.members.map((m) => m.state)).toEqual(['open', 'open', 'open']);
  });
});

describe('evolve: branch and PR', () => {
  it('records the branch commit, moves to active and clears the job and failures', () => {
    const state = fold([
      created(),
      {
        type: 'job_claimed',
        jobId: JOB(1),
        kind: 'plan_branch',
        cellId: CELL,
        epoch: 1,
      },
      { type: 'plan_branch_created', commit: COMMIT },
    ]);
    expect(state.phase).toEqual({ kind: 'active' });
    expect(state.branchCommit).toBe(COMMIT);
    expect(state.activeJob).toBeUndefined();
  });

  it('opens the PR into pr_open with state open, and clears failures', () => {
    const state = fold([
      ...chainOf3(),
      { type: 'plan_branch_created', commit: COMMIT },
      {
        type: 'plan_member_state_changed',
        orderId: orderOf('wo-1'),
        state: 'merged',
      },
      { type: 'plan_pr_opened', prUrl: PR_URL },
    ]);
    expect(state.phase).toEqual({ kind: 'pr_open' });
    expect(state.pr).toEqual({ url: PR_URL, state: 'open' });
  });

  it('marks the PR ready', () => {
    const state = fold([
      ...chainOf3(),
      { type: 'plan_branch_created', commit: COMMIT },
      { type: 'plan_pr_opened', prUrl: PR_URL },
      { type: 'plan_pr_ready' },
    ]);
    expect(state.phase).toEqual({ kind: 'ready' });
  });

  it('sets the PR state, and completes on a merge', () => {
    const base = [
      ...chainOf3(),
      { type: 'plan_branch_created' as const, commit: COMMIT },
      { type: 'plan_pr_opened' as const, prUrl: PR_URL },
    ];
    expect(
      fold([
        ...base,
        { type: 'plan_pr_state_changed', prUrl: PR_URL, state: 'closed' },
      ]).pr,
    ).toEqual({ url: PR_URL, state: 'closed' });
    const done = fold([
      ...base,
      { type: 'plan_pr_state_changed', prUrl: PR_URL, state: 'merged' },
      { type: 'plan_completed' },
    ]);
    expect(done.phase).toEqual({ kind: 'completed' });
  });

  it('cancels into a terminal phase with its reason', () => {
    const state = fold([
      created(),
      { type: 'plan_cancelled', reason: 'no longer needed' },
    ]);
    expect(state.phase).toEqual({
      kind: 'cancelled',
      reason: 'no longer needed',
    });
  });
});

describe('evolve: jobs, failures and Andons', () => {
  const claim = (n: number, epoch: number) => ({
    type: 'job_claimed' as const,
    jobId: JOB(n),
    kind: 'plan_branch' as const,
    cellId: CELL,
    epoch,
  });

  it('sets the active job and the epoch, and clears resumedWaiting', () => {
    const state = fold([created(), claim(1, 1)]);
    expect(state.activeJob).toEqual({
      jobId: JOB(1),
      kind: 'plan_branch',
      cellId: CELL,
      epoch: 1,
    });
    expect(state.epoch).toBe(1);
  });

  it('clears only the job a job_lost names', () => {
    const state = fold([
      created(),
      claim(1, 1),
      { type: 'job_lost', jobId: JOB(2), epoch: 1, reason: 'lease_expired' },
    ]);
    expect(state.activeJob?.jobId).toBe(JOB(1));
    const lost = fold([
      created(),
      claim(1, 1),
      { type: 'job_lost', jobId: JOB(1), epoch: 1, reason: 'lease_expired' },
    ]);
    expect(lost.activeJob).toBeUndefined();
  });

  it('records a failure under the cell of the job and ends the job', () => {
    const state = fold([
      created(),
      claim(1, 1),
      {
        type: 'plan_job_failed',
        jobId: JOB(1),
        kind: 'plan_branch',
        detail: 'push refused',
      },
    ]);
    expect(state.activeJob).toBeUndefined();
    expect(state.failures).toEqual([{ cellId: CELL, jobId: JOB(1), at: 30 }]);
  });

  it('raises an Andon and clears it on resume, with the failures', () => {
    const raised = fold([
      created(),
      claim(1, 1),
      {
        type: 'plan_job_failed',
        jobId: JOB(1),
        kind: 'plan_branch',
        detail: 'x',
      },
      { type: 'andon_raised', reason: 'plan_job_failed', detail: 'twice' },
    ]);
    expect(raised.andon).toMatchObject({
      reason: 'plan_job_failed',
      detail: 'twice',
    });
    const resumed = fold([
      created(),
      claim(1, 1),
      {
        type: 'plan_job_failed',
        jobId: JOB(1),
        kind: 'plan_branch',
        detail: 'x',
      },
      { type: 'andon_raised', reason: 'plan_job_failed', detail: 'twice' },
      {
        type: 'resumed',
        resumeId: RESUME,
        by: 'alice',
        mode: { kind: 'retry_station' },
      },
    ]);
    expect(resumed.andon).toBeUndefined();
    expect(resumed.failures).toEqual([]);
    expect(resumed.resumedWaiting).toBe(true);
  });

  it('forgets the closed PR on resume of plan_pr_closed and goes back to active', () => {
    const state = fold([
      ...chainOf3(),
      { type: 'plan_branch_created', commit: COMMIT },
      { type: 'plan_pr_opened', prUrl: PR_URL },
      { type: 'plan_pr_state_changed', prUrl: PR_URL, state: 'closed' },
      { type: 'andon_raised', reason: 'plan_pr_closed', detail: 'closed' },
      {
        type: 'resumed',
        resumeId: RESUME,
        by: 'alice',
        mode: { kind: 'retry_station' },
      },
    ]);
    expect(state.pr).toBeUndefined();
    expect(state.phase).toEqual({ kind: 'active' });
  });
});
