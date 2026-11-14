// The ProjectStore contract (STORAGE §4 `projects`, PROTOCOL §3.1). The in-memory fake and the SQLite
// store run this same suite. It takes `describe` and `it` from the caller, like `lease-contract.ts`.
import { type ProjectId, projectIdSchema } from '../ids';
import type { BoardStatus } from '../order/status';
import type {
  ProjectRecord,
  ProjectStore,
  ProjectStoreResult,
} from '../ports/projects';
import { assertSame } from './harness';
import type { ProjectHistorySeed } from './fakes-ports';
import type { ContractRunner } from './store-contract';

/** A project store under test, plus the hooks that give a project history (orders, events, intake). */
export interface ProjectUnderTest extends ProjectHistorySeed {
  store: ProjectStore;
  close(): Promise<void>;
}

export type ProjectFactory = () => Promise<ProjectUnderTest>;

const ALPHA = projectIdSchema.parse('alpha');
const BETA = projectIdSchema.parse('beta');
const MISSING = projectIdSchema.parse('gamma');

const recordOf = (
  projectId: ProjectId,
  overrides: Partial<ProjectRecord> = {},
): ProjectRecord => ({
  projectId,
  repoUrl: `https://example.test/${projectId}.git`,
  baseBranch: 'main',
  maxRunning: 2,
  depPolicy: 'delivered',
  ...overrides,
});

/** Runs `body` against a fresh store and closes it afterwards. */
const withProjects = async (
  create: ProjectFactory,
  body: (under: ProjectUnderTest) => Promise<void>,
): Promise<void> => {
  const under = await create();
  try {
    await body(under);
  } finally {
    await under.close();
  }
};

const assertRefused = (
  result: ProjectStoreResult,
  reason: string,
  label: string,
): void => {
  assertSame(result, { ok: false, reason }, label);
};

const BUSY_STATUSES: readonly BoardStatus[] = ['queued', 'running', 'andon'];

export const defineProjectStoreContract = (
  runner: ContractRunner,
  label: string,
  create: ProjectFactory,
): void => {
  runner.describe(`ProjectStore contract: ${label}`, () => {
    runner.it('lists added projects sorted by id', () =>
      withProjects(create, async ({ store }) => {
        assertSame(
          await store.add(recordOf(BETA), 10),
          { ok: true },
          'add beta',
        );
        assertSame(
          await store.add(recordOf(ALPHA), 20),
          { ok: true },
          'add alpha',
        );

        assertSame(
          await store.list(),
          [recordOf(ALPHA), recordOf(BETA)],
          'both projects, alpha first',
        );
      }),
    );

    runner.it('refuses to add a project whose id exists', () =>
      withProjects(create, async ({ store }) => {
        await store.add(recordOf(ALPHA), 10);

        assertRefused(
          await store.add(recordOf(ALPHA, { maxRunning: 5 }), 20),
          'exists',
          'a second add of alpha',
        );
        assertSame(
          await store.list(),
          [recordOf(ALPHA)],
          'the first record is kept',
        );
      }),
    );

    runner.it('changes each settable field', () =>
      withProjects(create, async ({ store }) => {
        await store.add(recordOf(ALPHA), 10);

        assertSame(
          await store.set(ALPHA, { baseBranch: 'develop' }),
          { ok: true },
          'baseBranch',
        );
        assertSame(
          await store.set(ALPHA, { maxRunning: 4 }),
          { ok: true },
          'maxRunning',
        );
        assertSame(
          await store.set(ALPHA, { depPolicy: 'merged' }),
          { ok: true },
          'depPolicy',
        );

        assertSame(
          await store.list(),
          [
            recordOf(ALPHA, {
              baseBranch: 'develop',
              maxRunning: 4,
              depPolicy: 'merged',
            }),
          ],
          'the three fields changed, the repository did not',
        );
      }),
    );

    runner.it('refuses to set a project that does not exist', () =>
      withProjects(create, async ({ store }) => {
        assertRefused(
          await store.set(MISSING, { maxRunning: 3 }),
          'missing',
          'set of an unknown project',
        );
      }),
    );

    runner.it('accepts a base branch that is already the current one', () =>
      withProjects(create, async ({ store, seedOrder }) => {
        await store.add(recordOf(ALPHA), 10);
        await seedOrder(ALPHA, 'running');

        assertSame(
          await store.set(ALPHA, { baseBranch: 'main' }),
          { ok: true },
          'the same base branch is a no-op',
        );
      }),
    );

    runner.it('refuses a base branch change while a Work order is open', () =>
      withProjects(create, async ({ store, seedOrder }) => {
        await store.add(recordOf(ALPHA), 10);
        for (const status of BUSY_STATUSES) await seedOrder(ALPHA, status);

        assertRefused(
          await store.set(ALPHA, { baseBranch: 'develop' }),
          'base_branch_busy',
          'base change with open orders',
        );
        assertSame(
          await store.list(),
          [recordOf(ALPHA)],
          'the base branch is unchanged',
        );
      }),
    );

    runner.it(
      'allows max running and dependency policy changes while running',
      () =>
        withProjects(create, async ({ store, seedOrder }) => {
          await store.add(recordOf(ALPHA), 10);
          await seedOrder(ALPHA, 'running');

          assertSame(
            await store.set(ALPHA, { maxRunning: 6, depPolicy: 'merged' }),
            { ok: true },
            'the non-base fields change under a running order',
          );
        }),
    );

    runner.it(
      'allows a base branch change once every Work order is terminal',
      () =>
        withProjects(create, async ({ store, seedOrder }) => {
          await store.add(recordOf(ALPHA), 10);
          await seedOrder(ALPHA, 'delivered');
          await seedOrder(ALPHA, 'merged');
          await seedOrder(ALPHA, 'cancelled');

          assertSame(
            await store.set(ALPHA, { baseBranch: 'develop' }),
            { ok: true },
            'base change with only terminal orders',
          );
        }),
    );

    runner.it('removes a project with no history', () =>
      withProjects(create, async ({ store }) => {
        await store.add(recordOf(ALPHA), 10);
        await store.add(recordOf(BETA), 20);

        assertSame(await store.remove(ALPHA), { ok: true }, 'remove alpha');
        assertSame(await store.list(), [recordOf(BETA)], 'only beta is left');
      }),
    );

    runner.it('refuses to remove a project that does not exist', () =>
      withProjects(create, async ({ store }) => {
        assertRefused(await store.remove(MISSING), 'missing', 'remove unknown');
      }),
    );

    runner.it('refuses to remove a project with a Work order', () =>
      withProjects(create, async ({ store, seedOrder }) => {
        await store.add(recordOf(ALPHA), 10);
        await seedOrder(ALPHA, 'cancelled');

        assertRefused(
          await store.remove(ALPHA),
          'has_history',
          'remove with an order',
        );
      }),
    );

    runner.it('refuses to remove a project with an event', () =>
      withProjects(create, async ({ store, seedEvent }) => {
        await store.add(recordOf(ALPHA), 10);
        await seedEvent(ALPHA);

        assertRefused(
          await store.remove(ALPHA),
          'has_history',
          'remove with an event',
        );
      }),
    );

    runner.it('refuses to remove a project with an intake row', () =>
      withProjects(create, async ({ store, seedIntake }) => {
        await store.add(recordOf(ALPHA), 10);
        await seedIntake(ALPHA);

        assertRefused(
          await store.remove(ALPHA),
          'has_history',
          'remove with intake',
        );
      }),
    );
  });
};
