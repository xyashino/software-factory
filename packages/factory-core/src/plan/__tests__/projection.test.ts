import { describe, expect, it } from 'vitest';
import { planNextJob } from '../next-job';
import { toPlanProjection } from '../projection';
import {
  CELL,
  COMMIT,
  JOB,
  PLAN_ID,
  PR_URL,
  PROJECT,
  SLUG,
  chainOf3,
  created,
  fold,
  orderOf,
} from './harness';

const META = (state: ReturnType<typeof fold>, lastSeq = 3) => ({
  lastSeq,
  createdAt: 10,
  updatedAt: 30,
  next: planNextJob(state),
});

describe('toPlanProjection', () => {
  it('has the plan columns of STORAGE §4, members in chain order', () => {
    const row = toPlanProjection(fold(chainOf3()), META(fold(chainOf3())));
    expect(row).toMatchObject({
      planId: PLAN_ID,
      projectId: PROJECT,
      slug: SLUG,
      branch: 'feat/xyz',
      baseBranch: 'main',
      phase: 'branching',
      prUrl: null,
      prState: null,
      branchCommit: null,
      holder: 'queue',
      nextKind: 'job',
      jobKind: 'plan_branch',
      avoidCells: [],
      andonReason: null,
      createdAt: 10,
      updatedAt: 30,
      lastSeq: 3,
    });
    expect(row.members.map((m) => m.todoId)).toEqual(['wo-1', 'wo-2', 'wo-3']);
  });

  it('holds the plan with the cell, the supervisor, the members or nobody, by its next step', () => {
    const claimed = fold([
      created(),
      {
        type: 'job_claimed',
        jobId: JOB(1),
        kind: 'plan_branch',
        cellId: CELL,
        epoch: 1,
      },
    ]);
    expect(toPlanProjection(claimed, META(claimed)).holder).toBe('cell');
    const andon = fold([
      created(),
      { type: 'andon_raised', reason: 'plan_job_failed', detail: 'x' },
    ]);
    expect(toPlanProjection(andon, META(andon)).holder).toBe('supervisor');
    const waiting = fold([
      ...chainOf3(),
      { type: 'plan_branch_created', commit: COMMIT },
    ]);
    expect(toPlanProjection(waiting, META(waiting)).holder).toBe('members');
    const done = fold([created(), { type: 'plan_cancelled', reason: 'x' }]);
    expect(toPlanProjection(done, META(done)).holder).toBe('none');
  });

  it('carries the PR and the branch commit once they exist', () => {
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
    expect(toPlanProjection(state, META(state))).toMatchObject({
      phase: 'pr_open',
      branchCommit: COMMIT,
      prUrl: PR_URL,
      prState: 'open',
    });
  });

  it('is a function of the state and meta: the same input gives the same row', () => {
    const state = fold(chainOf3());
    expect(toPlanProjection(state, META(state))).toEqual(
      toPlanProjection(state, META(state)),
    );
  });
});
