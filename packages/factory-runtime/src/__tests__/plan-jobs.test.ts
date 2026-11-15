import { afterEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, CommitSha, PlanId } from '@repo/factory-core/ids';
import { planIdOf, planSlugSchema } from '@repo/factory-core/ids';
import { RuntimeError } from '../errors';
import { createPlanCommands } from '../plan-commands';
import { PROJECT, helloCell, world, type World } from './test-kit';

const CELL = '01J0000000000000000000000W' as CellId;
const OTHER = '01J0000000000000000000000X' as CellId;
const COMMIT = 'd'.repeat(40) as CommitSha;
const PR_URL = 'https://example.test/software-factory/pull/21';

let running: World | undefined;

afterEach(() => {
  running?.runtime.stop();
  running = undefined;
});

/** A todo file with a plan and an optional in-plan dependency. */
const planTodo = (name: string, deps: string[] = []) => ({
  file: `todos/${name}.md`,
  text: [
    '---',
    'status: todo',
    'factory: v2',
    'plan: xyz',
    ...(deps.length === 0 ? [] : [`depends_on: [${deps.join(', ')}]`]),
    '---',
    '',
    `# ${name}`,
    '',
    'Body.',
    '',
  ].join('\n'),
});

const chainTodos = () => [
  planTodo('wo-1'),
  planTodo('wo-2', ['wo-1']),
  planTodo('wo-3', ['wo-2']),
];

/** A world with the three-member plan synced and one Cell. */
const planWorld = async () => {
  const w = world();
  running = w;
  w.git.setTodos(chainTodos());
  await w.runtime.sync();
  await helloCell(w, CELL);
  const planId = planIdOf(PROJECT, planSlugSchema.parse('xyz')) as PlanId;
  return { w, planId };
};

const claim = async (w: World, cellId: CellId = CELL): Promise<Job | null> =>
  (await w.runtime.call('claim', { cellId, waitMs: 0 })).job;

/** The Cell's report of a plan job, as the wire sends it (the plan variant of `submitCommand`). */
const report = (
  w: World,
  planId: PlanId,
  job: Job,
  command: Record<string, unknown>,
  commandId = `${job.jobId}:report`,
) =>
  w.runtime.call('submitCommand', {
    cellId: CELL,
    planId,
    commandId,
    epoch: job.epoch,
    jobId: job.jobId,
    command,
  } as never);

/** The factory's own plan commands (member state, PR state, claims), through the plan loop. */
const planCommands = (w: World) => createPlanCommands(w.ports, () => undefined);

const planRow = async (w: World, planId: PlanId) =>
  (await w.events.plans()).find((plan) => plan.planId === planId);

describe('claiming a plan job (PROTOCOL §4)', () => {
  it('offers the plan_branch job to a Cell and writes its lease', async () => {
    const { w, planId } = await planWorld();

    const job = await claim(w);

    expect(job).toMatchObject({
      kind: 'plan_branch',
      orderId: planId,
      repo: { baseBranch: 'main', branch: 'feat/xyz' },
      base: { branchBase: 'main' },
      plan: { slug: 'xyz' },
    });
    expect(job?.workspace).toBeUndefined();
    expect(await w.leases.list()).toEqual([
      expect.objectContaining({
        orderId: planId,
        jobId: job?.jobId,
        cellId: CELL,
        epoch: 1,
      }),
    ]);
  });

  it('gives a busy Cell no second job while the first runs', async () => {
    const { w } = await planWorld();
    expect(await claim(w)).not.toBeNull();
    expect(await claim(w)).toBeNull();
  });

  it('does not offer a plan to a Cell that serves another project', async () => {
    const { w } = await planWorld();
    await w.runtime.call('hello', {
      cellId: OTHER,
      version: '0.1.0',
      projects: ['elsewhere' as never],
      runners: [],
      capabilities: [],
    });
    expect(await claim(w, OTHER)).toBeNull();
  });
});

describe('plan commands from a Cell (PROTOCOL §8.2)', () => {
  it('a dry run decides and fences, and appends nothing', async () => {
    const { w, planId } = await planWorld();
    const job = (await claim(w)) as Job;
    const before = (await w.events.loadPlan(planId)).length;

    const dry = await w.runtime.call('submitCommand', {
      cellId: CELL,
      planId,
      commandId: 'dry-branch',
      epoch: job.epoch,
      jobId: job.jobId,
      dryRun: true,
      command: { type: 'ReportPlanBranch', commit: COMMIT },
    } as never);

    expect(dry).toEqual({
      dryRun: true,
      events: [{ type: 'plan_branch_created', commit: COMMIT }],
      next: null,
    });
    expect((await w.events.loadPlan(planId)).length).toBe(before);
    expect((await planRow(w, planId))?.phase).toBe('branching');
  });

  it('refuses a report under a stale epoch with stale_epoch and appends nothing', async () => {
    const { w, planId } = await planWorld();
    const job = (await claim(w)) as Job;

    const stale = report(w, planId, { ...job, epoch: job.epoch + 1 } as Job, {
      type: 'ReportPlanBranch',
      commit: COMMIT,
    });

    await expect(stale).rejects.toMatchObject({
      wire: { code: 'stale_epoch' },
    });
    expect((await planRow(w, planId))?.phase).toBe('branching');
  });

  it('refuses a claim sent by a Cell: only the factory claims', async () => {
    const { w, planId } = await planWorld();
    const job = (await claim(w)) as Job;
    await expect(
      report(w, planId, job, { type: 'ClaimJob', cellId: CELL }),
    ).rejects.toBeInstanceOf(RuntimeError);
  });

  it('a report that ends the job appends under its epoch and drops the lease', async () => {
    const { w, planId } = await planWorld();
    const job = (await claim(w)) as Job;

    const result = await report(w, planId, job, {
      type: 'ReportPlanBranch',
      commit: COMMIT,
    });

    expect(result).toEqual({
      dryRun: false,
      events: [{ type: 'plan_branch_created', commit: COMMIT }],
      next: null,
    });
    expect((await planRow(w, planId))?.phase).toBe('active');
    expect(await w.leases.list()).toEqual([]);
  });
});

describe('an expired plan lease (PROTOCOL §5.4)', () => {
  it('is reaped to job_lost, the plan is claimable again, and the old epoch is stale', async () => {
    const { w, planId } = await planWorld();
    const first = (await claim(w)) as Job;

    w.clock.advance(61_000);
    expect(await w.runtime.reapOnce()).toBe(1);

    expect(await w.leases.list()).toEqual([]);
    expect((await planRow(w, planId))?.nextKind).toBe('job');

    const second = (await claim(w)) as Job;
    expect(second.jobId).not.toBe(first.jobId);
    expect(second.epoch).toBe(first.epoch + 1);
    await expect(
      report(w, planId, first, { type: 'ReportPlanBranch', commit: COMMIT }),
    ).rejects.toMatchObject({ wire: { code: 'stale_epoch' } });
  });
});

describe('the plan lifecycle to completion (CORE §12.3)', () => {
  it('branch, root merged, plan PR, ready, merged: the plan completes', async () => {
    const { w, planId } = await planWorld();
    const plans = planCommands(w);

    // plan_branch
    const branch = (await claim(w)) as Job;
    expect(branch.kind).toBe('plan_branch');
    await report(w, planId, branch, {
      type: 'ReportPlanBranch',
      commit: COMMIT,
    });

    // The root member merges: the plan can open its PR.
    const root = `${PROJECT}:wo-1`;
    await plans.submit({
      planId,
      commandId: 'root-merged',
      command: {
        type: 'RecordMemberState',
        orderId: root as never,
        state: 'merged',
      },
      actor: { kind: 'factory' },
    });

    // plan_pr: the job carries the sub-PR list as its body.
    const pr = (await claim(w)) as Job;
    expect(pr.kind).toBe('plan_pr');
    const body = await w.blobs.get(pr.plan!.bodyBlob!);
    expect(new TextDecoder().decode(body!)).toContain('wo-1');
    await report(w, planId, pr, { type: 'ReportPlanPr', prUrl: PR_URL });
    expect((await planRow(w, planId))?.prUrl).toBe(PR_URL);

    // Every member merges: the plan PR is marked ready.
    for (const todo of ['wo-2', 'wo-3']) {
      await plans.submit({
        planId,
        commandId: `${todo}-merged`,
        command: {
          type: 'RecordMemberState',
          orderId: `${PROJECT}:${todo}` as never,
          state: 'merged',
        },
        actor: { kind: 'factory' },
      });
    }
    const ready = (await claim(w)) as Job;
    expect(ready).toMatchObject({
      kind: 'plan_pr_ready',
      plan: { prUrl: PR_URL },
    });
    await report(w, planId, ready, { type: 'ReportPlanReady' });
    expect((await planRow(w, planId))?.phase).toBe('ready');

    // The PR is merged on GitHub: the poll completes the plan, and a second pass records nothing.
    w.prState.set(PR_URL, 'merged');
    expect(await w.runtime.pollPrStates()).toBe(1);
    expect((await planRow(w, planId))?.phase).toBe('completed');
    expect(await w.runtime.pollPrStates()).toBe(0);
  });

  it('a closed plan PR raises the plan_pr_closed Andon', async () => {
    const { w, planId } = await planWorld();
    const plans = planCommands(w);
    const branch = (await claim(w)) as Job;
    await report(w, planId, branch, {
      type: 'ReportPlanBranch',
      commit: COMMIT,
    });
    await plans.submit({
      planId,
      commandId: 'root-merged-2',
      command: {
        type: 'RecordMemberState',
        orderId: `${PROJECT}:wo-1` as never,
        state: 'merged',
      },
      actor: { kind: 'factory' },
    });
    const pr = (await claim(w)) as Job;
    await report(w, planId, pr, { type: 'ReportPlanPr', prUrl: PR_URL });

    w.prState.set(PR_URL, 'closed');
    await w.runtime.pollPrStates();

    const row = await planRow(w, planId);
    expect(row?.prState).toBe('closed');
    expect(row?.andonReason).toBe('plan_pr_closed');
  });
});
