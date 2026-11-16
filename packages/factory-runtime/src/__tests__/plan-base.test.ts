import { describe, expect, it } from 'vitest';
import {
  planIdOf,
  planSlugSchema,
  projectIdSchema,
  orderIdOf,
  todoIdSchema,
  type OrderId,
  type PlanSlug,
  type TodoId,
} from '@repo/factory-core/ids';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import {
  fold,
  history,
  created,
} from '@repo/factory-core/testing/event-builders';
import { readQueue } from '../queue';
import { resolveBase } from '../job-builder';

const PROJECT = projectIdSchema.parse('software-factory');
const XYZ: PlanSlug = planSlugSchema.parse('xyz');
const wo = (name: string): OrderId =>
  orderIdOf(PROJECT, todoIdSchema.parse(name) as TodoId);

/** An order row as the projection holds it; the fields the queue and base read are set by `over`. */
const row = (
  name: string,
  over: Partial<OrderProjection> = {},
): OrderProjection => ({
  orderId: wo(name),
  projectId: PROJECT,
  todoId: todoIdSchema.parse(name),
  title: name,
  line: 'feature',
  priority: 'medium',
  dependsOn: [],
  plan: XYZ,
  baseBranch: 'main',
  lastSeq: 1,
  status: 'queued',
  holder: 'queue',
  nextKind: 'job',
  jobKind: 'run_operator_station',
  runner: null,
  stationId: null,
  stationIndex: null,
  progressed: false,
  resumed: false,
  lastCellId: null,
  avoidCells: [],
  andonReason: null,
  prUrl: null,
  prState: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const planRow = (phase: PlanProjection['phase']): PlanProjection => ({
  planId: planIdOf(PROJECT, XYZ),
  projectId: PROJECT,
  slug: XYZ,
  branch: 'feat/xyz',
  baseBranch: 'main',
  lastSeq: 1,
  phase,
  holder: 'queue',
  nextKind: 'job',
  jobKind: 'plan_branch',
  members: [
    {
      orderId: wo('wo-1'),
      todoId: todoIdSchema.parse('wo-1') as TodoId,
      state: 'open',
    },
    {
      orderId: wo('wo-2'),
      todoId: todoIdSchema.parse('wo-2') as TodoId,
      after: wo('wo-1'),
      state: 'open',
    },
  ],
  branchCommit: null,
  prUrl: null,
  prState: null,
  lastCellId: null,
  avoidCells: [],
  andonReason: null,
  createdAt: 1,
  updatedAt: 1,
});

/** The queue reader, over synthetic rows: only the projections, the projects and the clock it reads. */
const queueOf = async (rows: OrderProjection[], plans: PlanProjection[]) => {
  const queue = await readQueue({
    projections: { orders: async () => rows, plans: async () => plans },
    projects: {
      list: async () => [
        {
          projectId: PROJECT,
          depPolicy: 'delivered',
          maxRunning: 2,
          baseBranch: 'main',
        },
      ],
    },
    clock: { now: () => 0 },
  } as unknown as Parameters<typeof readQueue>[0]);
  return new Map(queue.entries.map((entry) => [entry.orderId, entry.deps]));
};

describe('queue: in-plan dependencies use the stacked outcome (CORE §12.4, §12.6)', () => {
  it.each([
    ['queued', null, 'waiting'],
    ['delivered', 'open', 'satisfied'],
    ['delivered', 'closed', 'broken'],
    ['merged', 'merged', 'satisfied'],
    ['cancelled', null, 'broken'],
  ] as const)(
    'a predecessor %s with PR %s makes wo-2 %s',
    async (status, prState, expected) => {
      const deps = await queueOf(
        [
          row('wo-1', {
            status,
            prState,
            holder: 'queue',
            nextKind: 'done',
            lastSeq: 2,
          }),
          row('wo-2', { dependsOn: [wo('wo-1')] }),
        ],
        [planRow('active')],
      );
      expect(deps.get(wo('wo-2'))).toBe(expected);
    },
  );

  it('gates the root while the plan is branching, and frees it once the branch exists', async () => {
    const root = row('wo-1');
    expect(
      (await queueOf([root], [planRow('branching')])).get(root.orderId),
    ).toBe('waiting');
    expect((await queueOf([root], [planRow('active')])).get(root.orderId)).toBe(
      'satisfied',
    );
  });

  it('keeps a member waiting when its plan row is missing (a race intake resolves)', async () => {
    expect(
      (await queueOf([row('wo-2', { dependsOn: [] })], [])).get(wo('wo-2')),
    ).toBe('waiting');
  });

  it('keeps depPolicy for a dependency that is outside the plan', async () => {
    const plain = row('plain', {
      plan: null,
      status: 'delivered',
      prState: 'open',
      nextKind: 'done',
    });
    const deps = await queueOf(
      [plain, row('wo-9', { plan: null, dependsOn: [plain.orderId] })],
      [],
    );
    expect(deps.get(wo('wo-9'))).toBe('satisfied');
  });
});

describe('the base branch of a job (CORE §12.5)', () => {
  const stateOf = (name: string, over: Parameters<typeof created>[0] = {}) =>
    fold(
      history(
        created({
          todoId: todoIdSchema.parse(name),
          baseBranch: 'release/9',
          ...over,
        }),
      ),
    );

  it('uses the pinned baseBranch of a plain Work order, never the project base', () => {
    expect(resolveBase(stateOf('plain'), [])).toBe('release/9');
  });

  it('uses feat/<slug> for the root', () => {
    expect(
      resolveBase(stateOf('wo-1', { plan: XYZ, baseBranch: 'main' }), [
        row('wo-1'),
      ]),
    ).toBe('feat/xyz');
  });

  it('uses factory/<predecessor> while the predecessor is delivered and its PR is not merged', () => {
    const state = stateOf('wo-2', {
      plan: XYZ,
      dependsOn: [wo('wo-1')],
      baseBranch: 'main',
    });
    expect(
      resolveBase(state, [
        row('wo-1', { status: 'delivered', prState: 'open' }),
      ]),
    ).toBe('factory/wo-1');
  });

  it('uses feat/<slug> once the predecessor PR is merged', () => {
    const state = stateOf('wo-2', {
      plan: XYZ,
      dependsOn: [wo('wo-1')],
      baseBranch: 'main',
    });
    expect(
      resolveBase(state, [
        row('wo-1', { status: 'merged', prState: 'merged' }),
      ]),
    ).toBe('feat/xyz');
  });
});
