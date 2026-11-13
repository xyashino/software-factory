import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import {
  andonRaised,
  blobOf,
  cancelled,
  commitOf,
  contextOf,
  created,
  cycleIdOf,
  generatedIdOf,
  jobIdOf,
  priorityChanged,
  questionAsked,
  workerIdOf,
  workspaceFailed,
} from './builders';
import {
  claim,
  createCommand,
  deliveredEvents,
  deliveringEvents,
  start,
  stateOf,
} from './histories';

const worker = contextOf(
  { kind: 'worker', workerId: workerIdOf(1) },
  { epoch: 1 },
);

describe('CreateOrder', () => {
  it('creates the order for the factory', () => {
    const result = decide(undefined, createCommand(), contextOf());

    expect(result).toEqual({
      ok: true,
      value: [expect.objectContaining({ type: 'order_created' })],
    });
  });

  it('refuses an order that already exists', () => {
    const state = stateOf([created()]);

    const result = decide(state, createCommand(), contextOf());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Work order already exists' },
    });
  });

  it('refuses a supervisor who creates an order', () => {
    const result = decide(
      undefined,
      createCommand(),
      contextOf({ kind: 'supervisor', name: 'dev' }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor supervisor may not run this command',
      },
    });
  });
});

describe('UpdateSpec', () => {
  const update = {
    type: 'UpdateSpec' as const,
    spec: created().spec,
    priority: 'high' as const,
    dependsOn: [],
  };

  it('updates the spec before any job is claimed', () => {
    const state = stateOf([created()]);

    const result = decide(state, update, contextOf());

    expect(result).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ type: 'spec_updated', priority: 'high' }),
      ],
    });
  });

  it('refuses an update once a job was claimed', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, update, contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'a job was claimed, so the spec is frozen',
      },
    });
  });

  it('refuses an update of a cancelled order', () => {
    const state = stateOf([created(), cancelled()]);

    const result = decide(state, update, contextOf());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Work order is cancelled' },
    });
  });
});

describe('Cancel', () => {
  const cancel = { type: 'Cancel' as const, reason: 'superseded' };
  const supervisor = contextOf({ kind: 'supervisor', name: 'dev' });

  it('cancels a queued order', () => {
    const state = stateOf([created()]);

    const result = decide(state, cancel, supervisor);

    expect(result).toEqual({
      ok: true,
      value: [{ type: 'cancelled', reason: 'superseded' }],
    });
  });

  it('fails the running Cycle and loses the job', () => {
    const state = stateOf([created(), claim(1), start(1, 'plan')]);

    const result = decide(state, cancel, supervisor);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'cycle_failed',
          cycleId: cycleIdOf(1),
          reason: 'lost',
          detail: 'the Work order was cancelled',
        },
        {
          type: 'job_lost',
          jobId: jobIdOf(1),
          epoch: 1,
          reason: 'cancelled',
        },
        { type: 'cancelled', reason: 'superseded' },
      ],
    });
  });

  it('abandons the open question before it fails the Cycle', () => {
    const state = stateOf([
      created(),
      claim(1),
      start(1, 'plan'),
      questionAsked(),
    ]);

    const result = decide(state, cancel, supervisor);

    expect(result).toEqual({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({ type: 'question_abandoned' }),
      ]),
    });
    expect(result.ok && result.value.map((event) => event.type)).toEqual([
      'question_abandoned',
      'cycle_failed',
      'job_lost',
      'cancelled',
    ]);
  });

  it('loses a claimed job whose Cycle never started', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, cancel, supervisor);

    expect(result.ok && result.value.map((event) => event.type)).toEqual([
      'job_lost',
      'cancelled',
    ]);
  });

  it('refuses to cancel a delivered order', () => {
    const state = stateOf(deliveredEvents());

    const result = decide(state, cancel, supervisor);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'a delivered Work order cannot be cancelled',
      },
    });
  });

  it('refuses a second cancel', () => {
    const state = stateOf([created(), cancelled()]);

    const result = decide(state, cancel, supervisor);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the Work order is already cancelled',
      },
    });
  });

  it('refuses a worker actor', () => {
    const state = stateOf([created()]);

    const result = decide(state, cancel, worker);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor worker may not run this command',
      },
    });
  });
});

describe('Reprioritise', () => {
  const reprioritise = {
    type: 'Reprioritise' as const,
    priority: 'low' as const,
  };

  it('changes the priority', () => {
    const state = stateOf([created()]);

    const result = decide(
      state,
      reprioritise,
      contextOf({ kind: 'supervisor', name: 'dev' }),
    );

    expect(result).toEqual({
      ok: true,
      value: [priorityChanged({ priority: 'low' })],
    });
  });

  it('refuses a cancelled order', () => {
    const state = stateOf([created(), cancelled()]);

    const result = decide(
      state,
      reprioritise,
      contextOf({ kind: 'supervisor', name: 'dev' }),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Work order is cancelled' },
    });
  });

  it('refuses the factory actor', () => {
    const state = stateOf([created()]);

    const result = decide(state, reprioritise, contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor factory may not run this command',
      },
    });
  });
});

describe('ClaimJob', () => {
  const claimJob = { type: 'ClaimJob' as const, workerId: workerIdOf(1) };

  it('claims the first job with a fresh job and Cycle id', () => {
    const state = stateOf([created()]);

    const result = decide(state, claimJob, contextOf());

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'job_claimed',
          jobId: generatedIdOf(1),
          kind: 'run_operator_station',
          workerId: workerIdOf(1),
          epoch: 1,
          cycleId: generatedIdOf(2),
        },
      ],
    });
  });

  it('claims a delivery job without a Cycle', () => {
    const state = stateOf(deliveringEvents());

    const result = decide(state, claimJob, contextOf());

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'job_claimed',
          jobId: generatedIdOf(1),
          kind: 'deliver',
          workerId: workerIdOf(1),
          epoch: 5,
        },
      ],
    });
  });

  it('refuses a claim while a job is active', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, claimJob, contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the Work order is held by worker',
      },
    });
  });

  it('refuses a claim while an Andon is raised', () => {
    const state = stateOf([created(), andonRaised()]);

    const result = decide(state, claimJob, contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'the Work order is held by supervisor',
      },
    });
  });

  it('refuses a claim on a delivered order', () => {
    const state = stateOf(deliveredEvents());

    const result = decide(state, claimJob, contextOf());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Work order is held by none' },
    });
  });

  it('refuses a claim when nextJob raises an Andon', () => {
    const state = stateOf([
      created(),
      claim(1),
      workspaceFailed({ jobId: jobIdOf(1) }),
      claim(2),
      workspaceFailed({ jobId: jobIdOf(2) }),
    ]);

    const result = decide(state, claimJob, contextOf());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'nextJob is raise_andon, not a job',
      },
    });
  });

  it('refuses a supervisor actor', () => {
    const state = stateOf([created()]);

    const result = decide(
      state,
      claimJob,
      contextOf({ kind: 'supervisor', name: 'dev' }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor supervisor may not run this command',
      },
    });
  });
});

describe('ReportWorkspaceFailed', () => {
  const failed = {
    type: 'ReportWorkspaceFailed' as const,
    stage: 'worktree' as const,
    detail: 'worktree could not be created',
    logBlob: blobOf(7),
  };

  it('records a workspace that could not be prepared', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, failed, worker);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'workspace_failed',
          jobId: jobIdOf(1),
          stage: 'worktree',
          detail: 'worktree could not be created',
          logBlob: blobOf(7),
        },
      ],
    });
  });

  it('refuses a stale epoch', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(
      state,
      failed,
      contextOf({ kind: 'worker', workerId: workerIdOf(1) }, { epoch: 0 }),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });

  it('refuses once the Cycle has started', () => {
    const state = stateOf([created(), claim(1), start(1, 'plan')]);

    const result = decide(state, failed, worker);

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Cycle has already started' },
    });
  });

  it('refuses a log that does not exist', () => {
    const state = stateOf([created(), claim(1)]);
    const missing = contextOf(
      { kind: 'worker', workerId: workerIdOf(1) },
      { epoch: 1, missing: [blobOf(7)] },
    );

    const result = decide(state, failed, missing);

    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid', issues: [`blob ${blobOf(7)} does not exist`] },
    });
  });

  it('refuses the factory actor', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(
      state,
      failed,
      contextOf({ kind: 'factory' }, { epoch: 1 }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor factory may not run this command',
      },
    });
  });
});

describe('ExpireLease', () => {
  const expire = { type: 'ExpireLease' as const };
  const reaper = contextOf({ kind: 'factory' }, { epoch: 1 });

  it('loses a job whose lease expired mid-Cycle', () => {
    const state = stateOf([created(), claim(1), start(1, 'plan')]);

    const result = decide(state, expire, reaper);

    expect(result.ok && result.value.map((event) => event.type)).toEqual([
      'cycle_failed',
      'job_lost',
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ type: 'cycle_failed', reason: 'lost' }),
        {
          type: 'job_lost',
          jobId: jobIdOf(1),
          epoch: 1,
          reason: 'lease_expired',
        },
      ],
    });
  });

  it('loses a claimed job whose Cycle never started', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, expire, reaper);

    expect(result.ok && result.value.map((event) => event.type)).toEqual([
      'job_lost',
    ]);
  });

  it('refuses a stale epoch', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(
      state,
      expire,
      contextOf({ kind: 'factory' }, { epoch: 2 }),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });

  it('refuses a worker actor', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(state, expire, worker);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor worker may not run this command',
      },
    });
  });
});

describe('ReleaseJob', () => {
  const release = { type: 'ReleaseJob' as const };

  it('loses the job when the worker leaves its running Cycle', () => {
    const state = stateOf([created(), claim(1), start(1, 'plan')]);

    const result = decide(state, release, worker);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'cycle_failed',
          cycleId: cycleIdOf(1),
          reason: 'lost',
          detail: 'the worker left the job',
        },
        {
          type: 'job_lost',
          jobId: jobIdOf(1),
          epoch: 1,
          reason: 'worker_left',
        },
      ],
    });
  });

  it('refuses a stale epoch', () => {
    const state = stateOf([created(), claim(1)]);

    const result = decide(
      state,
      release,
      contextOf({ kind: 'worker', workerId: workerIdOf(1) }, { epoch: 3 }),
    );

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 1 },
    });
  });
});

describe('ReportDelivery', () => {
  const finished = {
    type: 'ReportDelivery' as const,
    result: {
      status: 'finished' as const,
      prUrl: 'https://github.com/example/software-factory/pull/42',
      commit: commitOf(6),
    },
  };
  const deliverer = (epoch: number) =>
    contextOf({ kind: 'worker', workerId: workerIdOf(1) }, { epoch });

  it('records the PR the delivery opened', () => {
    const state = stateOf([...deliveringEvents(), claim(5, 'deliver')]);

    const result = decide(state, finished, deliverer(5));

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'delivery_finished',
          jobId: jobIdOf(5),
          prUrl: 'https://github.com/example/software-factory/pull/42',
          commit: commitOf(6),
        },
      ],
    });
  });

  it('records a failed delivery', () => {
    const state = stateOf([...deliveringEvents(), claim(5, 'deliver')]);

    const result = decide(
      state,
      {
        type: 'ReportDelivery',
        result: { status: 'failed', detail: 'push was rejected' },
      },
      deliverer(5),
    );

    expect(result).toEqual({
      ok: true,
      value: [
        {
          type: 'delivery_failed',
          jobId: jobIdOf(5),
          detail: 'push was rejected',
        },
      ],
    });
  });

  it('refuses a job that is not a delivery', () => {
    const state = stateOf([created(), claim(1), start(1, 'plan')]);

    const result = decide(state, finished, worker);

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the job is not a delivery' },
    });
  });

  it('refuses a stale epoch', () => {
    const state = stateOf([...deliveringEvents(), claim(5, 'deliver')]);

    const result = decide(state, finished, deliverer(4));

    expect(result).toEqual({
      ok: false,
      error: { code: 'stale_epoch', current: 5 },
    });
  });
});

describe('RecordPrState', () => {
  const merged = {
    type: 'RecordPrState' as const,
    prUrl: 'https://github.com/example/software-factory/pull/42',
    state: 'merged' as const,
  };

  it('records the PR state once a PR exists', () => {
    const state = stateOf(deliveredEvents());

    const result = decide(state, merged, contextOf());

    expect(result).toEqual({
      ok: true,
      value: [
        expect.objectContaining({ type: 'pr_state_changed', state: 'merged' }),
      ],
    });
  });

  it('refuses a Work order with no PR', () => {
    const state = stateOf([created()]);

    const result = decide(state, merged, contextOf());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Work order has no PR' },
    });
  });

  it('refuses a worker actor', () => {
    const state = stateOf(deliveredEvents());

    const result = decide(state, merged, worker);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'precondition',
        detail: 'actor worker may not run this command',
      },
    });
  });
});
