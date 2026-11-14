import { describe, expect, it } from 'vitest';
import { decidePlan } from '../decide';
import type { PlanCommand } from '../commands';
import {
  CELL,
  COMMIT,
  FACTORY,
  JOB,
  PLAN_ID,
  PR_URL,
  PROJECT,
  RESUME,
  SLUG,
  SUPERVISOR,
  cellActor,
  chainOf3,
  created,
  ctxOf,
  fold,
  member,
  orderOf,
  refused,
  run,
  todoOf,
} from './harness';
import { commitShaSchema } from '../../ids';

const claimed = (
  epoch: number,
  kind: 'plan_branch' | 'plan_pr' | 'plan_pr_ready' = 'plan_branch',
) => ({
  type: 'job_claimed' as const,
  jobId: JOB(1),
  kind,
  cellId: CELL,
  epoch,
});

/** A chain whose root is merged and whose branch exists, so the plan PR may be opened. */
const merged = () => [
  ...chainOf3(),
  { type: 'plan_branch_created' as const, commit: COMMIT },
  claimed(2, 'plan_pr'),
];

const mergeAll = () => [
  ...chainOf3(),
  { type: 'plan_branch_created' as const, commit: COMMIT },
  {
    type: 'plan_member_state_changed' as const,
    orderId: orderOf('wo-1'),
    state: 'merged' as const,
  },
  {
    type: 'plan_member_state_changed' as const,
    orderId: orderOf('wo-2'),
    state: 'merged' as const,
  },
  {
    type: 'plan_member_state_changed' as const,
    orderId: orderOf('wo-3'),
    state: 'merged' as const,
  },
  { type: 'plan_pr_opened' as const, prUrl: PR_URL },
];

describe('decide: CreatePlan', () => {
  it('creates the plan for the factory', () => {
    const outcome = run(undefined, {
      type: 'CreatePlan',
      planId: PLAN_ID,
      projectId: PROJECT,
      slug: SLUG,
      baseBranch: 'main',
    });
    expect(outcome.ok && outcome.events).toEqual([
      {
        type: 'plan_created',
        projectId: PROJECT,
        slug: SLUG,
        branch: 'feat/xyz',
        baseBranch: 'main',
      },
    ]);
  });

  it('refuses when the plan exists, and an actor other than the factory', () => {
    const createCmd: PlanCommand = {
      type: 'CreatePlan',
      planId: PLAN_ID,
      projectId: PROJECT,
      slug: SLUG,
      baseBranch: 'main',
    };
    expect(
      refused(run(fold([created()]), createCmd, ctxOf(FACTORY))).code,
    ).toBe('precondition');
    expect(refused(run(undefined, createCmd, ctxOf(cellActor()))).code).toBe(
      'precondition',
    );
  });

  it('refuses every command on a plan that does not exist', () => {
    expect(
      refused(
        run(undefined, { type: 'Cancel', reason: 'x' }, ctxOf(SUPERVISOR)),
      ),
    ).toEqual({ code: 'not_found' });
  });
});

describe('decide: AddPlanMember', () => {
  const add = (name: string, after?: string): PlanCommand => ({
    type: 'AddPlanMember',
    orderId: orderOf(name),
    todoId: todoOf(name),
    ...(after === undefined ? {} : { after: orderOf(after) }),
  });

  it('adds the root with no predecessor, then a member after the last one', () => {
    const root = run(fold([created()]), add('wo-1'));
    expect(root.ok && root.events).toEqual([member('wo-1')]);
    const second = run(fold([created(), member('wo-1')]), add('wo-2', 'wo-1'));
    expect(second.ok && second.events).toEqual([member('wo-2', 'wo-1')]);
  });

  it('refuses a root that names a predecessor, and a member that does not name the last one', () => {
    expect(refused(run(fold([created()]), add('wo-1', 'wo-0'))).code).toBe(
      'precondition',
    );
    const state = fold([created(), member('wo-1')]);
    expect(refused(run(state, add('wo-3', 'wo-9'))).code).toBe('precondition');
    expect(refused(run(state, add('wo-3'))).code).toBe('precondition');
  });

  it('refuses a duplicate member', () => {
    expect(
      refused(run(fold([created(), member('wo-1')]), add('wo-1'))).code,
    ).toBe('precondition');
  });

  it('refuses in ready, completed and cancelled phases', () => {
    const ready = fold([
      ...merged(),
      { type: 'plan_pr_opened', prUrl: PR_URL },
      { type: 'plan_pr_ready' },
    ]);
    expect(refused(run(ready, add('wo-9', 'wo-3'))).code).toBe('precondition');
    const cancelled = fold([
      created(),
      { type: 'plan_cancelled', reason: 'x' },
    ]);
    expect(refused(run(cancelled, add('wo-9'))).code).toBe('precondition');
  });

  it('refuses a cell', () => {
    expect(
      refused(run(fold([created()]), add('wo-1'), ctxOf(cellActor()))).code,
    ).toBe('precondition');
  });
});

describe('decide: RecordMemberState', () => {
  const report = (
    name: string,
    state: 'delivered' | 'merged' | 'open' | 'closed' | 'cancelled',
  ) =>
    ({
      type: 'RecordMemberState',
      orderId: orderOf(name),
      state,
    }) as PlanCommand;

  it('records a change of a member state', () => {
    const outcome = run(fold(chainOf3()), report('wo-1', 'delivered'));
    expect(outcome.ok && outcome.events).toEqual([
      {
        type: 'plan_member_state_changed',
        orderId: orderOf('wo-1'),
        state: 'delivered',
      },
    ]);
  });

  it('refuses a Work order that is not a member, an unchanged state, and a cell', () => {
    const state = fold(chainOf3());
    expect(refused(run(state, report('nope', 'merged'))).code).toBe(
      'precondition',
    );
    expect(refused(run(state, report('wo-1', 'open'))).code).toBe(
      'precondition',
    );
    expect(
      refused(run(state, report('wo-1', 'merged'), ctxOf(cellActor()))).code,
    ).toBe('precondition');
  });
});

describe('decide: ClaimJob', () => {
  const claim: PlanCommand = { type: 'ClaimJob', cellId: CELL };

  it('claims the next job with the next epoch', () => {
    const outcome = run(fold([created()]), claim);
    expect(outcome.ok && outcome.events).toEqual([
      {
        type: 'job_claimed',
        jobId: expect.any(String),
        kind: 'plan_branch',
        cellId: CELL,
        epoch: 1,
      },
    ]);
  });

  it('refuses while a job is active, and when nextJob is not a job', () => {
    expect(refused(run(fold([created(), claimed(1)]), claim)).code).toBe(
      'precondition',
    );
    expect(
      refused(
        run(
          fold([
            ...chainOf3(),
            { type: 'plan_branch_created', commit: COMMIT },
          ]),
          claim,
        ),
      ).code,
    ).toBe('precondition');
  });

  it('refuses a cell', () => {
    expect(
      refused(run(fold([created()]), claim, ctxOf(cellActor()))).code,
    ).toBe('precondition');
  });
});

describe('decide: cell reports are fenced by the active job epoch', () => {
  it('ReportPlanBranch: the epoch must match the active job', () => {
    const state = fold([created(), claimed(1)]);
    const ok = run(
      state,
      { type: 'ReportPlanBranch', commit: commitShaSchema.parse(COMMIT) },
      ctxOf(cellActor(), 1),
    );
    expect(ok.ok && ok.events).toEqual([
      { type: 'plan_branch_created', commit: COMMIT },
    ]);
    expect(
      refused(
        run(
          state,
          { type: 'ReportPlanBranch', commit: COMMIT },
          ctxOf(cellActor(), 2),
        ),
      ),
    ).toEqual({ code: 'stale_epoch', current: 1 });
  });

  it('refuses a report with no active job, a report from a supervisor, and the wrong kind', () => {
    const idle = fold([created()]);
    expect(
      refused(
        run(
          idle,
          { type: 'ReportPlanBranch', commit: COMMIT },
          ctxOf(cellActor(), 1),
        ),
      ).code,
    ).toBe('stale_epoch');
    const active = fold([created(), claimed(1)]);
    expect(
      refused(
        run(
          active,
          { type: 'ReportPlanBranch', commit: COMMIT },
          ctxOf(SUPERVISOR, 1),
        ),
      ).code,
    ).toBe('precondition');
    const pr = fold([
      ...merged(),
      {
        type: 'job_claimed',
        jobId: JOB(2),
        kind: 'plan_pr_ready',
        cellId: CELL,
        epoch: 3,
      },
    ]);
    expect(
      refused(
        run(
          pr,
          { type: 'ReportPlanBranch', commit: COMMIT },
          ctxOf(cellActor(), 3),
        ),
      ).code,
    ).toBe('precondition');
  });

  it('ReportPlanPr is refused until the root is merged (P2)', () => {
    const unmerged = fold([
      ...chainOf3(),
      { type: 'plan_branch_created', commit: COMMIT },
      {
        type: 'job_claimed',
        jobId: JOB(1),
        kind: 'plan_pr',
        cellId: CELL,
        epoch: 2,
      },
    ]);
    expect(
      refused(
        run(
          unmerged,
          { type: 'ReportPlanPr', prUrl: PR_URL },
          ctxOf(cellActor(), 2),
        ),
      ).code,
    ).toBe('precondition');
    const root = fold([
      ...merged().slice(0, 4),
      {
        type: 'plan_member_state_changed',
        orderId: orderOf('wo-1'),
        state: 'merged',
      },
      {
        type: 'job_claimed',
        jobId: JOB(1),
        kind: 'plan_pr',
        cellId: CELL,
        epoch: 3,
      },
    ]);
    const outcome = run(
      root,
      { type: 'ReportPlanPr', prUrl: PR_URL },
      ctxOf(cellActor(), 3),
    );
    expect(outcome.ok && outcome.events).toEqual([
      { type: 'plan_pr_opened', prUrl: PR_URL },
    ]);
  });

  it('ReportPlanReady needs every member merged (P5)', () => {
    const notAll = fold([
      ...merged(),
      { type: 'plan_pr_opened', prUrl: PR_URL },
      {
        type: 'job_claimed',
        jobId: JOB(3),
        kind: 'plan_pr_ready',
        cellId: CELL,
        epoch: 3,
      },
    ]);
    expect(
      refused(run(notAll, { type: 'ReportPlanReady' }, ctxOf(cellActor(), 3)))
        .code,
    ).toBe('precondition');
    const all = fold([
      ...mergeAll(),
      {
        type: 'job_claimed',
        jobId: JOB(3),
        kind: 'plan_pr_ready',
        cellId: CELL,
        epoch: 3,
      },
    ]);
    const outcome = run(
      all,
      { type: 'ReportPlanReady' },
      ctxOf(cellActor(), 3),
    );
    expect(outcome.ok && outcome.events).toEqual([{ type: 'plan_pr_ready' }]);
  });

  it('ReportPlanJobFailed names the active job and its kind', () => {
    const state = fold([created(), claimed(1)]);
    const outcome = run(
      state,
      { type: 'ReportPlanJobFailed', detail: 'push refused' },
      ctxOf(cellActor(), 1),
    );
    expect(outcome.ok && outcome.events).toEqual([
      {
        type: 'plan_job_failed',
        jobId: JOB(1),
        kind: 'plan_branch',
        detail: 'push refused',
      },
    ]);
  });
});

describe('decide: RecordPlanPrState', () => {
  const open = () => [
    ...merged(),
    { type: 'plan_pr_opened' as const, prUrl: PR_URL },
  ];
  const change = (
    state: 'open' | 'merged' | 'closed',
    prUrl = PR_URL,
  ): PlanCommand => ({
    type: 'RecordPlanPrState',
    prUrl,
    state,
  });

  it('records a closed PR, and a merge also completes the plan', () => {
    const state = fold(open());
    const closed = run(state, change('closed'));
    expect(closed.ok && closed.events).toEqual([
      { type: 'plan_pr_state_changed', prUrl: PR_URL, state: 'closed' },
    ]);
    const merge = run(state, change('merged'));
    expect(merge.ok && merge.events.map((e) => e.type)).toEqual([
      'plan_pr_state_changed',
      'plan_completed',
    ]);
  });

  it('refuses a plan with no PR, another PR, and an unchanged state', () => {
    expect(refused(run(fold(merged()), change('merged'))).code).toBe(
      'precondition',
    );
    expect(
      refused(
        run(fold(open()), change('merged', 'https://github.com/o/r/pull/9')),
      ).code,
    ).toBe('precondition');
    expect(refused(run(fold(open()), change('open')))).toMatchObject({
      code: 'precondition',
    });
  });
});

describe('decide: ExpireLease, ReleaseJob, Resume, Cancel', () => {
  it('ExpireLease and ReleaseJob end the active job when the job and epoch match', () => {
    const state = fold([created(), claimed(1)]);
    const expire = run(state, { type: 'ExpireLease', jobId: JOB(1), epoch: 1 });
    expect(expire.ok && expire.events).toEqual([
      { type: 'job_lost', jobId: JOB(1), epoch: 1, reason: 'lease_expired' },
    ]);
    const release = run(
      state,
      { type: 'ReleaseJob', jobId: JOB(1), epoch: 1 },
      ctxOf(cellActor(), 1),
    );
    expect(release.ok && release.events).toEqual([
      { type: 'job_lost', jobId: JOB(1), epoch: 1, reason: 'cell_left' },
    ]);
  });

  it('refuses a stale job or epoch, and a cell expiring a lease', () => {
    const state = fold([created(), claimed(1)]);
    expect(
      refused(run(state, { type: 'ExpireLease', jobId: JOB(1), epoch: 2 }))
        .code,
    ).toBe('stale_epoch');
    expect(
      refused(run(state, { type: 'ExpireLease', jobId: JOB(2), epoch: 1 }))
        .code,
    ).toBe('stale_epoch');
    expect(
      refused(
        run(
          state,
          { type: 'ExpireLease', jobId: JOB(1), epoch: 1 },
          ctxOf(cellActor(), 1),
        ),
      ).code,
    ).toBe('precondition');
  });

  it('Resume needs an Andon and a supervisor, and names the supervisor', () => {
    const cmd: PlanCommand = { type: 'Resume', resumeId: RESUME, by: 'alice' };
    expect(refused(run(fold([created()]), cmd, ctxOf(SUPERVISOR))).code).toBe(
      'precondition',
    );
    const andon = fold([
      created(),
      { type: 'andon_raised', reason: 'plan_job_failed', detail: 'x' },
    ]);
    const outcome = run(andon, cmd, ctxOf(SUPERVISOR));
    expect(outcome.ok && outcome.events).toEqual([
      {
        type: 'resumed',
        resumeId: RESUME,
        by: 'alice',
        mode: { kind: 'retry_station' },
      },
    ]);
    expect(refused(run(andon, cmd, ctxOf(FACTORY))).code).toBe('precondition');
  });

  it('Cancel ends a non-terminal plan and loses its active job', () => {
    const idle = run(
      fold([created()]),
      { type: 'Cancel', reason: 'stop' },
      ctxOf(SUPERVISOR),
    );
    expect(idle.ok && idle.events).toEqual([
      { type: 'plan_cancelled', reason: 'stop' },
    ]);
    const active = run(
      fold([created(), claimed(1)]),
      { type: 'Cancel', reason: 'stop' },
      ctxOf(SUPERVISOR),
    );
    expect(active.ok && active.events.map((e) => e.type)).toEqual([
      'plan_cancelled',
      'job_lost',
    ]);
    const done = fold([
      ...mergeAll(),
      { type: 'plan_pr_state_changed', prUrl: PR_URL, state: 'merged' },
      { type: 'plan_completed' },
    ]);
    expect(
      refused(run(done, { type: 'Cancel', reason: 'late' }, ctxOf(SUPERVISOR)))
        .code,
    ).toBe('precondition');
  });
});

describe('decidePlan is pure', () => {
  it('gives the same answer for the same state and command', () => {
    const state = fold([created()]);
    const cmd: PlanCommand = { type: 'ClaimJob', cellId: CELL };
    expect(decidePlan(state, cmd, ctxOf())).toEqual(
      decidePlan(state, cmd, ctxOf()),
    );
  });
});
