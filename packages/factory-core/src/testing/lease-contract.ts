// The LeaseStore contract (STORAGE §4 `leases`, PROTOCOL §5). The in-memory fake and the SQLite store
// run this same suite. It takes `describe` and `it` from the caller, like `store-contract.ts`.
import {
  type CellId,
  type JobId,
  type OrderId,
  cellIdSchema,
  jobIdSchema,
  orderIdOf,
  projectIdSchema,
  todoIdSchema,
} from '../ids';
import type { Lease, LeaseStore } from '../ports/lease-store';
import { type ContractRunner } from './store-contract';
import { assertSame } from './harness';

/** A lease store under test. `seedCell` makes the Cell a lease may name (a `cells` row in SQLite). */
export interface LeaseUnderTest {
  store: LeaseStore;
  seedCell(cellId: CellId): Promise<void>;
  close(): Promise<void>;
}

export type LeaseFactory = () => Promise<LeaseUnderTest>;

const PROJECT = projectIdSchema.parse('software-factory');
const orderOf = (name: string): OrderId =>
  orderIdOf(PROJECT, todoIdSchema.parse(name));
const CELL_A = cellIdSchema.parse('01J00000000000000000000A01');
const CELL_B = cellIdSchema.parse('01J00000000000000000000B01');
const job = (n: number): JobId =>
  jobIdSchema.parse(`01J0000000000000000000J${n.toString().padStart(3, '0')}`);

const leaseOf = (
  name: string,
  jobNumber: number,
  cellId: CellId,
  expiresAt: number,
): Lease => ({
  orderId: orderOf(name),
  jobId: job(jobNumber),
  cellId,
  epoch: 1,
  expiresAt,
});

/** Runs `body` against a fresh store and closes it afterwards. */
const withLeases = async (
  create: LeaseFactory,
  body: (under: LeaseUnderTest) => Promise<void>,
): Promise<void> => {
  const under = await create();
  try {
    await body(under);
  } finally {
    await under.close();
  }
};

const expiriesOf = (leases: readonly Lease[]): [string, number][] =>
  leases.map((lease) => [lease.orderId, lease.expiresAt]);

const expectThrow = async (
  action: () => Promise<void>,
  label: string,
): Promise<void> => {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${label}: expected an error, none was thrown`);
};

export const defineLeaseStoreContract = (
  runner: ContractRunner,
  label: string,
  create: LeaseFactory,
): void => {
  runner.describe(`LeaseStore contract: ${label}`, () => {
    runner.it('stores an inserted lease and lists it for its Cell', () =>
      withLeases(create, async ({ store, seedCell }) => {
        await seedCell(CELL_A);
        const lease = leaseOf('todo-a', 1, CELL_A, 60_000);
        await store.insert(lease);

        assertSame(await store.list(), [lease], 'the lease is listed');
        assertSame(await store.forCell(CELL_A), [lease], 'the Cell holds it');
        assertSame(await store.forCell(CELL_B), [], 'no other Cell holds it');
      }),
    );

    runner.it('refuses a second lease for the same order (I4)', () =>
      withLeases(create, async ({ store, seedCell }) => {
        await seedCell(CELL_A);
        await store.insert(leaseOf('todo-a', 1, CELL_A, 60_000));
        await expectThrow(
          () => store.insert(leaseOf('todo-a', 2, CELL_A, 60_000)),
          'a second lease on one order',
        );
      }),
    );

    runner.it('refuses a lease for a job that already holds one', () =>
      withLeases(create, async ({ store, seedCell }) => {
        await seedCell(CELL_A);
        await store.insert(leaseOf('todo-a', 1, CELL_A, 60_000));
        await expectThrow(
          () => store.insert(leaseOf('todo-b', 1, CELL_A, 60_000)),
          'a second lease on one job',
        );
      }),
    );

    runner.it('extends only the listed jobs of the given Cell', () =>
      withLeases(create, async ({ store, seedCell }) => {
        await seedCell(CELL_A);
        await seedCell(CELL_B);
        await store.insert(leaseOf('todo-a', 1, CELL_A, 100));
        await store.insert(leaseOf('todo-b', 2, CELL_A, 100));
        await store.insert(leaseOf('todo-c', 3, CELL_B, 100));

        await store.extend(CELL_A, [job(1), job(3)], 500);

        assertSame(
          expiriesOf(await store.list()),
          [
            [orderOf('todo-a'), 500],
            [orderOf('todo-b'), 100],
            [orderOf('todo-c'), 100],
          ],
          'job 1 of Cell A is extended; job 2 is not listed and job 3 belongs to Cell B',
        );
      }),
    );

    runner.it('lists expired leases at or before now, earliest first', () =>
      withLeases(create, async ({ store, seedCell }) => {
        await seedCell(CELL_A);
        await store.insert(leaseOf('todo-a', 1, CELL_A, 300));
        await store.insert(leaseOf('todo-b', 2, CELL_A, 100));
        await store.insert(leaseOf('todo-c', 3, CELL_A, 200));

        assertSame(
          expiriesOf(await store.expired(200)),
          [
            [orderOf('todo-b'), 100],
            [orderOf('todo-c'), 200],
          ],
          'expiry equal to now is expired; later expiry is not',
        );
      }),
    );

    runner.it('deletes a lease and treats a second delete as a no-op', () =>
      withLeases(create, async ({ store, seedCell }) => {
        await seedCell(CELL_A);
        await store.insert(leaseOf('todo-a', 1, CELL_A, 60_000));

        await store.delete(orderOf('todo-a'));
        await store.delete(orderOf('todo-a'));

        assertSame(await store.list(), [], 'no lease is left');
      }),
    );

    runner.it('moves every expiry on boot grace to now + ttl', () =>
      withLeases(create, async ({ store, seedCell }) => {
        await seedCell(CELL_A);
        await seedCell(CELL_B);
        await store.insert(leaseOf('todo-a', 1, CELL_A, 10));
        await store.insert(leaseOf('todo-b', 2, CELL_B, 20));

        await store.bootGrace(1_000, 60_000);

        assertSame(
          expiriesOf(await store.list()),
          [
            [orderOf('todo-a'), 61_000],
            [orderOf('todo-b'), 61_000],
          ],
          'every lease expires at now + ttl',
        );
      }),
    );
  });
};
