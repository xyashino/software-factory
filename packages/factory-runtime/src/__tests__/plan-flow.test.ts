import { describe, expect, it } from 'vitest';
import type { CellId, CommitSha } from '@repo/factory-core/ids';
import { planIdOf, planSlugSchema } from '@repo/factory-core/ids';
import { createPlanCommands } from '../plan-commands';
import { createPlan, PROJECT, helloCell, world, type World } from './test-kit';

const CELL = '01J0000000000000000000000W' as CellId;
const COMMIT = 'd'.repeat(40) as CommitSha;

const CHAIN = ['wo-1', 'wo-2', 'wo-3'];

/** The Order Plan of `xyz`, as the plans projection holds it, or undefined. */
const planOf = async (w: World) =>
  (await w.events.plans()).find((plan) => plan.slug === 'xyz');

const eventCount = async (w: World): Promise<number> =>
  (await w.events.feed(0, 10_000)).length +
  (await w.events.loadPlan(planIdOf(PROJECT, planSlugSchema.parse('xyz'))))
    .length;

describe('creating an Order Plan (CORE §12.2, §12.7)', () => {
  it('creates one plan and three Work orders, in chain order', async () => {
    const w = world();

    const created = await createPlan(w, 'xyz', CHAIN);

    expect(created.orderIds).toHaveLength(3);
    const plan = await planOf(w);
    expect(plan).toMatchObject({
      phase: 'branching',
      baseBranch: 'main',
      branch: 'feat/xyz',
    });
    expect(plan?.members.map((member) => member.todoId)).toEqual(CHAIN);
    expect(plan?.members.map((member) => member.after ?? null)).toEqual([
      null,
      `${PROJECT}:wo-1`,
      `${PROJECT}:wo-2`,
    ]);
    const orders = await w.events.orders();
    expect(orders.map((row) => row.plan)).toEqual(['xyz', 'xyz', 'xyz']);
    expect(orders.map((row) => row.baseBranch)).toEqual([
      'main',
      'main',
      'main',
    ]);
  });

  it('creates nothing on a replayed request with the same command id', async () => {
    const w = world();
    await createPlan(w, 'xyz', CHAIN, { commandId: 'plan-xyz-once' });
    const before = await eventCount(w);

    await createPlan(w, 'xyz', CHAIN, { commandId: 'plan-xyz-once' });

    expect(await eventCount(w)).toBe(before);
    expect(await w.events.orders()).toHaveLength(3);
  });
});

describe('the root of a plan waits for the branch (CORE §12.6, P3)', () => {
  it('offers the plan_branch job first, not the root, then the root on feat/xyz', async () => {
    const w = world();
    await createPlan(w, 'xyz', CHAIN);
    await helloCell(w, CELL);
    const planId = (await planOf(w))!.planId;

    const early = await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
    expect(early.job).toMatchObject({ kind: 'plan_branch', orderId: planId });
    const branchJob = early.job!;

    const plans = createPlanCommands(w.ports, () => undefined);
    await plans.submit({
      planId,
      commandId: 'plan-branch',
      command: { type: 'ReportPlanBranch', commit: COMMIT },
      actor: { kind: 'cell', cellId: CELL },
      epoch: branchJob.epoch,
    });
    expect((await planOf(w))?.phase).toBe('active');

    const claimed = await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
    expect(claimed.job?.repo.baseBranch).toBe('feat/xyz');
  });

  it('holds wo-2 while wo-1 is running, so only the root is on offer', async () => {
    const w = world();
    await createPlan(w, 'xyz', CHAIN);
    await helloCell(w, CELL);
    const plans = createPlanCommands(w.ports, () => undefined);
    const planId = (await planOf(w))!.planId;
    await plans.submit({
      planId,
      commandId: 'plan-claim-branch',
      command: { type: 'ClaimJob', cellId: CELL },
      actor: { kind: 'factory' },
    });
    await plans.submit({
      planId,
      commandId: 'plan-branch',
      command: { type: 'ReportPlanBranch', commit: COMMIT },
      actor: { kind: 'cell', cellId: CELL },
      epoch: 1,
    });

    const first = await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
    expect(first.job?.repo.baseBranch).toBe('feat/xyz');
    const second = await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
    expect(second.job).toBeNull();
  });
});
