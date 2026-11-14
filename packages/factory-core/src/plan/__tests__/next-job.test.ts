import { describe, expect, it } from 'vitest';
import { planNextJob } from '../next-job';
import {
  CELL,
  COMMIT,
  JOB,
  PR_URL,
  chainOf3,
  created,
  fold,
  orderOf,
} from './harness';

const merge = (name: string) => ({
  type: 'plan_member_state_changed' as const,
  orderId: orderOf(name),
  state: 'merged' as const,
});

describe('planNextJob: the CORE §12.3 table, row by row', () => {
  it('row 1: a completed or cancelled plan is done', () => {
    expect(
      planNextJob(fold([created(), { type: 'plan_cancelled', reason: 'x' }])),
    ).toEqual({ kind: 'done' });
  });

  it('row 2: an active job means wait for the cell', () => {
    const state = fold([
      created(),
      {
        type: 'job_claimed',
        jobId: JOB(1),
        kind: 'plan_branch',
        cellId: CELL,
        epoch: 1,
      },
    ]);
    expect(planNextJob(state)).toEqual({
      kind: 'wait_cell',
      jobId: JOB(1),
      epoch: 1,
    });
  });

  it('row 3: an unresolved Andon means await the supervisor', () => {
    const state = fold([
      created(),
      { type: 'andon_raised', reason: 'plan_job_failed', detail: 'x' },
    ]);
    expect(planNextJob(state)).toEqual({
      kind: 'await_supervisor',
      cause: 'andon',
    });
  });

  it('row 4: two consecutive failures raise plan_job_failed', () => {
    const failed = (n: number) => [
      {
        type: 'job_claimed' as const,
        jobId: JOB(n),
        kind: 'plan_branch' as const,
        cellId: CELL,
        epoch: n,
      },
      {
        type: 'plan_job_failed' as const,
        jobId: JOB(n),
        kind: 'plan_branch' as const,
        detail: 'x',
      },
    ];
    expect(planNextJob(fold([created(), ...failed(1)]))).toEqual({
      kind: 'job',
      job: { kind: 'plan_branch' },
    });
    expect(planNextJob(fold([created(), ...failed(1), ...failed(2)]))).toEqual({
      kind: 'raise_andon',
      reason: 'plan_job_failed',
      detail: 'two plan jobs failed in a row',
    });
  });

  it('row 5: a closed PR raises plan_pr_closed', () => {
    const state = fold([
      ...chainOf3(),
      { type: 'plan_branch_created', commit: COMMIT },
      merge('wo-1'),
      { type: 'plan_pr_opened', prUrl: PR_URL },
      { type: 'plan_pr_state_changed', prUrl: PR_URL, state: 'closed' },
    ]);
    expect(planNextJob(state)).toEqual({
      kind: 'raise_andon',
      reason: 'plan_pr_closed',
      detail: 'the plan PR was closed without merging',
    });
  });

  it('row 6: a branching plan needs the plan_branch job', () => {
    expect(planNextJob(fold([created()]))).toEqual({
      kind: 'job',
      job: { kind: 'plan_branch' },
    });
  });

  it('row 7: an active plan opens its PR only once the root is merged', () => {
    const branch = [
      ...chainOf3(),
      { type: 'plan_branch_created' as const, commit: COMMIT },
    ];
    expect(planNextJob(fold(branch))).toEqual({ kind: 'wait_external' });
    expect(planNextJob(fold([...branch, merge('wo-1')]))).toEqual({
      kind: 'job',
      job: { kind: 'plan_pr' },
    });
  });

  it('row 8: an open PR with every member merged needs plan_pr_ready', () => {
    const opened = [
      ...chainOf3(),
      { type: 'plan_branch_created' as const, commit: COMMIT },
      merge('wo-1'),
      { type: 'plan_pr_opened' as const, prUrl: PR_URL },
    ];
    expect(planNextJob(fold(opened))).toEqual({ kind: 'wait_external' });
    const all = [...opened, merge('wo-2'), merge('wo-3')];
    expect(planNextJob(fold(all))).toEqual({
      kind: 'job',
      job: { kind: 'plan_pr_ready' },
    });
  });

  it('row 9: anything else waits for members or the PR to change', () => {
    const ready = fold([
      ...chainOf3(),
      { type: 'plan_branch_created', commit: COMMIT },
      merge('wo-1'),
      { type: 'plan_pr_opened', prUrl: PR_URL },
      { type: 'plan_pr_ready' },
    ]);
    expect(planNextJob(ready)).toEqual({ kind: 'wait_external' });
  });

  it('a merged plan is done after resume too: the terminal row wins over every other', () => {
    const merged = fold([
      ...chainOf3(),
      { type: 'plan_branch_created', commit: COMMIT },
      merge('wo-1'),
      { type: 'plan_pr_opened', prUrl: PR_URL },
      { type: 'plan_pr_state_changed', prUrl: PR_URL, state: 'merged' },
      { type: 'plan_completed' },
    ]);
    expect(planNextJob(merged)).toEqual({ kind: 'done' });
  });
});
