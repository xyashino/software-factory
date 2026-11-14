import { describe, expect, it } from 'vitest';
import type { CellId, CommitSha } from '@repo/factory-core/ids';
import { planIdOf, planSlugSchema } from '@repo/factory-core/ids';
import { createPlanCommands } from '../plan-commands';
import { PROJECT, helloCell, world, type World } from './test-kit';

const CELL = '01J0000000000000000000000W' as CellId;
const COMMIT = 'd'.repeat(40) as CommitSha;

/** A todo file with a plan, optional in-plan dependency, and the v2 cut-over marker. */
const planTodo = (
  name: string,
  plan: string | null,
  deps: string[] = [],
): { file: string; text: string } => ({
  file: `todos/${name}.md`,
  text: [
    '---',
    'status: todo',
    'factory: v2',
    ...(plan === null ? [] : [`plan: ${plan}`]),
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
  planTodo('wo-1', 'xyz'),
  planTodo('wo-2', 'xyz', ['wo-1']),
  planTodo('wo-3', 'xyz', ['wo-2']),
];

/** The Order Plan of `xyz`, as the plans projection holds it, or undefined. */
const planOf = async (w: World) =>
  (await w.events.plans()).find((plan) => plan.slug === 'xyz');

const eventCount = async (w: World): Promise<number> =>
  (await w.events.feed(0, 10_000)).length +
  (await w.events.loadPlan(planIdOf(PROJECT, planSlugSchema.parse('xyz'))))
    .length;

describe('intake of an Order Plan (CORE §12.2, §12.7)', () => {
  it('turns three plan todos into one plan and three Work orders, in chain order', async () => {
    const w = world();
    w.git.setTodos(chainTodos());

    const [report] = await w.runtime.sync();

    expect(report?.created.sort()).toEqual(['wo-1', 'wo-2', 'wo-3']);
    const plan = await planOf(w);
    expect(plan).toMatchObject({
      phase: 'branching',
      baseBranch: 'main',
      branch: 'feat/xyz',
    });
    expect(plan?.members.map((member) => member.todoId)).toEqual([
      'wo-1',
      'wo-2',
      'wo-3',
    ]);
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

  it('creates nothing on a replayed pass', async () => {
    const w = world();
    w.git.setTodos(chainTodos());
    await w.runtime.sync();
    const before = await eventCount(w);

    const [report] = await w.runtime.sync();

    expect(report?.created).toEqual([]);
    expect(await eventCount(w)).toBe(before);
  });

  it('refuses a branching plan with plan_invalid on every todo, and creates no plan and no order', async () => {
    const w = world();
    w.git.setTodos([
      planTodo('wo-1', 'xyz'),
      planTodo('wo-2', 'xyz', ['wo-1']),
      planTodo('wo-3', 'xyz', ['wo-1']),
    ]);

    const [report] = await w.runtime.sync();

    expect(report?.created).toEqual([]);
    expect(
      report?.diagnostics
        .filter((d) => d.kind === 'plan_invalid')
        .map((d) => d.todoId)
        .sort(),
    ).toEqual(['wo-1', 'wo-2', 'wo-3']);
    expect(await w.events.plans()).toEqual([]);
    expect(await w.events.orders()).toEqual([]);
  });

  it('refuses a cyclic plan the same way', async () => {
    const w = world();
    w.git.setTodos([
      planTodo('wo-1', 'xyz', ['wo-2']),
      planTodo('wo-2', 'xyz', ['wo-1']),
    ]);

    const [report] = await w.runtime.sync();

    expect(
      report?.diagnostics.filter((d) => d.kind === 'plan_invalid'),
    ).toHaveLength(2);
    expect(await w.events.orders()).toEqual([]);
  });
});

describe('the root of a plan waits for the branch (CORE §12.6, P3)', () => {
  it('offers the plan_branch job first, not the root, then the root on feat/xyz', async () => {
    const w = world();
    w.git.setTodos(chainTodos());
    await w.runtime.sync();
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
    w.git.setTodos(chainTodos());
    await w.runtime.sync();
    await helloCell(w, CELL, 2);
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
