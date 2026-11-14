// The EventStore contract (STORAGE §2, §3, §3.1). The in-memory fake and every real store run this
// same suite. It takes `describe` and `it` from the caller, so core ships no test framework; a
// failing check throws a plain Error.
import {
  type OrderId,
  type ProjectId,
  type TodoId,
  orderIdOf,
  projectIdSchema,
  todoIdSchema,
} from '../ids';
import type { Actor, OrderEvent, StoredEvent } from '../order/events';
import type { OrderProjection } from '../order/projection';
import type {
  AppendInput,
  AppendResult,
  EventStore,
} from '../ports/event-store';
import { created, cycleStarted, jobClaimed } from './event-builders';
import { assertSame } from './harness';

/** The runner the caller supplies: vitest's `describe` and `it` fit this shape. */
export interface ContractRunner {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => Promise<void>): void;
}

/** A store under test, plus the reads the suite needs beyond the port. */
export interface StoreUnderTest {
  store: EventStore;
  /** Makes the project Work orders belong to. A no-op where the store keeps no project table. */
  seedProject(projectId: ProjectId): Promise<void>;
  /** Every `orders` row, sorted by order id. */
  orders(): Promise<OrderProjection[]>;
  close(): Promise<void>;
}

export type StoreFactory = () => Promise<StoreUnderTest>;

const PROJECT: ProjectId = projectIdSchema.parse('software-factory');
const FACTORY: Actor = { kind: 'factory' };
const AT = 1000;

const todoOf = (name: string): TodoId => todoIdSchema.parse(name);
const orderOf = (name: string): OrderId => orderIdOf(PROJECT, todoOf(name));

const rowOf = (
  name: string,
  lastSeq: number,
  title: string,
): OrderProjection => ({
  orderId: orderOf(name),
  projectId: PROJECT,
  todoId: todoOf(name),
  title,
  line: 'factory-default',
  priority: 'medium',
  dependsOn: [],
  lastSeq,
  status: 'queued',
  holder: 'queue',
  nextKind: 'done',
  jobKind: null,
  runner: null,
  requiredCapabilities: [],
  stationId: null,
  stationIndex: null,
  progressed: false,
  resumed: false,
  lastCellId: null,
  avoidCells: [],
  andonReason: null,
  prUrl: null,
  prState: null,
  createdAt: AT,
  updatedAt: lastSeq * AT,
});

let commands = 0;
const freshCommand = (): string => {
  commands += 1;
  return `cmd-${commands}`;
};

const createdOf = (name: string): OrderEvent =>
  created({ todoId: todoOf(name) });

/** An append of `events` to order `name`, expecting `expectedSeq` already folded. */
const appendOf = (
  name: string,
  expectedSeq: number,
  events: OrderEvent[],
  over: Partial<AppendInput> = {},
): AppendInput => {
  const lastSeq = expectedSeq + events.length;
  return {
    orderId: orderOf(name),
    commandId: freshCommand(),
    expectedSeq,
    actor: FACTORY,
    at: AT * lastSeq,
    events,
    projection: rowOf(name, lastSeq, `after ${lastSeq}`),
    response: { lastSeq },
    ...over,
  };
};

const appended = (result: AppendResult): StoredEvent[] => {
  if (result.kind !== 'appended') {
    throw new Error(`expected appended, got ${result.kind}`);
  }
  return result.events;
};

const seqsOf = (events: readonly StoredEvent[]): number[] =>
  events.map((stored) => stored.seq);

/** A promise the test opens by hand, so ordering never depends on timers. */
interface Gate {
  wait: Promise<void>;
  open: () => void;
}

const gateOf = (): Gate => {
  let release: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, open: () => release() };
};

const outcomeOf = (settled: Promise<unknown>): Promise<string> =>
  settled.then(
    () => 'committed',
    (error: unknown) => (error instanceof Error ? error.message : 'other'),
  );

/** Runs one contract case against a fresh store, always closing it. */
const withStore = async (
  create: StoreFactory,
  body: (under: StoreUnderTest) => Promise<void>,
): Promise<void> => {
  const under = await create();
  try {
    await under.seedProject(PROJECT);
    await body(under);
  } finally {
    await under.close();
  }
};

export const defineEventStoreContract = (
  runner: ContractRunner,
  label: string,
  create: StoreFactory,
): void => {
  runner.describe(`EventStore contract: ${label}`, () => {
    runner.it(
      'appends a new order from sequence 1 and stamps every event',
      () =>
        withStore(create, async ({ store }) => {
          const events = appended(
            await store.append(
              appendOf('todo-a', 0, [createdOf('todo-a'), jobClaimed()], {
                at: AT,
              }),
            ),
          );
          assertSame(seqsOf(events), [1, 2], 'sequence numbers from 1');
          assertSame(
            events.every((stored) => stored.at === AT),
            true,
            'every event carries the append time',
          );
          assertSame(
            events.every((stored) => stored.commandId.startsWith('cmd-')),
            true,
            'every event carries the command id',
          );
          const globals = events.map((stored) => stored.globalSeq);
          assertSame(
            globals.every(
              (global, index) =>
                index === 0 || global > (globals[index - 1] ?? 0),
            ),
            true,
            'global sequence increases',
          );
          assertSame(
            await store.load(orderOf('todo-a')),
            events,
            'load returns what was appended',
          );
        }),
    );

    runner.it(
      'loads one order in sequence order and an unknown order as empty',
      () =>
        withStore(create, async ({ store }) => {
          await store.append(appendOf('todo-a', 0, [createdOf('todo-a')]));
          await store.append(appendOf('todo-b', 0, [createdOf('todo-b')]));
          await store.append(
            appendOf('todo-a', 1, [jobClaimed(), cycleStarted()]),
          );
          assertSame(
            seqsOf(await store.load(orderOf('todo-a'))),
            [1, 2, 3],
            'todo-a only, in seq order',
          );
          assertSame(
            await store.load(orderOf('todo-missing')),
            [],
            'unknown order has no events',
          );
        }),
    );

    runner.it(
      'feeds events in global order across orders, with a limit and an empty tail',
      () =>
        withStore(create, async ({ store }) => {
          await store.append(appendOf('todo-a', 0, [createdOf('todo-a')]));
          await store.append(appendOf('todo-b', 0, [createdOf('todo-b')]));
          await store.append(appendOf('todo-a', 1, [jobClaimed()]));
          const feed = await store.feed(0, 10);
          assertSame(
            feed.map((stored) => stored.globalSeq),
            [1, 2, 3],
            'global order',
          );
          assertSame(
            feed.map((stored) => stored.orderId),
            [orderOf('todo-a'), orderOf('todo-b'), orderOf('todo-a')],
            'orders interleave in append order',
          );
          assertSame(
            (await store.feed(0, 2)).map((stored) => stored.globalSeq),
            [1, 2],
            'limit',
          );
          assertSame(
            (await store.feed(1, 1)).map((stored) => stored.globalSeq),
            [2],
            'after a position',
          );
          assertSame(await store.feed(3, 5), [], 'empty past the tail');
        }),
    );

    runner.it(
      'refuses a stale expectedSeq with a conflict and writes nothing',
      () =>
        withStore(create, async ({ store, orders }) => {
          await store.append(
            appendOf('todo-a', 0, [createdOf('todo-a'), jobClaimed()]),
          );
          const before = {
            events: await store.load(orderOf('todo-a')),
            rows: await orders(),
            feed: await store.feed(0, 100),
          };
          const result = await store.append(
            appendOf('todo-a', 0, [cycleStarted()]),
          );
          assertSame(
            result,
            { kind: 'conflict', currentSeq: 2 },
            'the stale caller learns the current sequence',
          );
          assertSame(
            {
              events: await store.load(orderOf('todo-a')),
              rows: await orders(),
              feed: await store.feed(0, 100),
            },
            before,
            'nothing changed',
          );
        }),
    );

    runner.it(
      'replays a known commandId with the stored response and writes nothing',
      () =>
        withStore(create, async ({ store, orders }) => {
          const first = appendOf('todo-a', 0, [createdOf('todo-a')], {
            commandId: 'create-todo-a',
            response: { orderId: 'todo-a', lastSeq: 1 },
          });
          await store.append(first);
          const rowsBefore = await orders();
          const again = await store.append({
            ...first,
            events: [jobClaimed()],
            projection: rowOf('todo-a', 2, 'a different title'),
            response: { ignored: true },
          });
          assertSame(
            again,
            { kind: 'replayed', response: { orderId: 'todo-a', lastSeq: 1 } },
            'the stored response comes back',
          );
          assertSame(
            seqsOf(await store.load(orderOf('todo-a'))),
            [1],
            'no new event',
          );
          assertSame(
            await orders(),
            rowsBefore,
            'the projection is not written again',
          );
        }),
    );

    runner.it('keeps the orders row at the last appended sequence', () =>
      withStore(create, async ({ store, orders }) => {
        await store.append(
          appendOf('todo-a', 0, [createdOf('todo-a'), jobClaimed()]),
        );
        const row = (await orders()).find(
          (candidate) => candidate.orderId === orderOf('todo-a'),
        );
        assertSame(row?.lastSeq, 2, 'lastSeq is the last sequence');
        assertSame(row?.title, 'after 2', 'the projection handed in is stored');
        await store.append(appendOf('todo-a', 2, [cycleStarted()]));
        const later = (await orders()).find(
          (candidate) => candidate.orderId === orderOf('todo-a'),
        );
        assertSame(later?.lastSeq, 3, 'the row follows the next append');
      }),
    );

    runner.it('commits a transaction whose appends succeed', () =>
      withStore(create, async ({ store, orders }) => {
        const kind = await store.transaction(async (tx) => {
          const result = await tx.append(
            appendOf('todo-a', 0, [createdOf('todo-a')]),
          );
          return result.kind;
        });
        assertSame(kind, 'appended', 'the body sees its result');
        assertSame(
          seqsOf(await store.load(orderOf('todo-a'))),
          [1],
          'committed',
        );
        assertSame((await orders()).length, 1, 'projection committed');
      }),
    );

    runner.it(
      'rolls back a transaction that throws: events, projection and command are gone',
      () =>
        withStore(create, async ({ store, orders }) => {
          const outcome = await outcomeOf(
            store.transaction(async (tx) => {
              await tx.append(
                appendOf('todo-a', 0, [createdOf('todo-a')], {
                  commandId: 'create-rolled',
                }),
              );
              throw new Error('abort');
            }),
          );
          assertSame(outcome, 'abort', 'the error reaches the caller');
          assertSame(await store.load(orderOf('todo-a')), [], 'no events');
          assertSame(await orders(), [], 'no projection row');
          assertSame(await store.feed(0, 10), [], 'no feed entries');
          const retry = await store.append(
            appendOf('todo-a', 0, [createdOf('todo-a')], {
              commandId: 'create-rolled',
            }),
          );
          assertSame(
            retry.kind,
            'appended',
            'the rolled back command was never stored, so it is not replayed',
          );
        }),
    );

    runner.it(
      'never shows a reader the writes of a transaction that rolls back',
      () =>
        withStore(create, async ({ store }) => {
          const hold = gateOf();
          const writing = outcomeOf(
            store.transaction(async (tx) => {
              await tx.append(
                appendOf('todo-a', 0, [createdOf('todo-a'), jobClaimed()]),
              );
              await hold.wait;
              throw new Error('abort');
            }),
          );
          const reading = store.load(orderOf('todo-a'));
          hold.open();
          assertSame(await writing, 'abort', 'the transaction rolled back');
          assertSame(await reading, [], 'the reader saw nothing');
        }),
    );

    runner.it('never shows a reader part of a transaction that commits', () =>
      withStore(create, async ({ store }) => {
        const hold = gateOf();
        const writing = store.transaction(async (tx) => {
          await tx.append(appendOf('todo-a', 0, [createdOf('todo-a')]));
          await hold.wait;
          await tx.append(appendOf('todo-a', 1, [jobClaimed()]));
        });
        const reading = store.load(orderOf('todo-a'));
        hold.open();
        await writing;
        const seen = (await reading).length;
        assertSame(
          [0, 2].includes(seen),
          true,
          'a reader sees none or all of the transaction, never one of its two appends',
        );
      }),
    );

    runner.it('lets a transaction read its own writes', () =>
      withStore(create, async ({ store }) => {
        const seen = await store.transaction(async (tx) => {
          await tx.append(appendOf('todo-a', 0, [createdOf('todo-a')]));
          await tx.append(appendOf('todo-a', 1, [jobClaimed()]));
          return seqsOf(await tx.load(orderOf('todo-a')));
        });
        assertSame(seen, [1, 2], 'tx.load sees the transaction writes');
      }),
    );

    runner.it(
      'keeps a transaction open after one of its appends is refused',
      () =>
        withStore(create, async ({ store }) => {
          const kinds = await store.transaction(async (tx) => {
            const first = await tx.append(
              appendOf('todo-a', 0, [createdOf('todo-a')]),
            );
            const stale = await tx.append(
              appendOf('todo-a', 0, [jobClaimed()]),
            );
            const next = await tx.append(appendOf('todo-a', 1, [jobClaimed()]));
            return [first.kind, stale.kind, next.kind];
          });
          assertSame(
            kinds,
            ['appended', 'conflict', 'appended'],
            'the refusal does not end the transaction',
          );
          assertSame(
            seqsOf(await store.load(orderOf('todo-a'))),
            [1, 2],
            'only the accepted appends are stored',
          );
        }),
    );

    runner.it(
      'lets exactly one of two concurrent appenders on the same order win',
      () =>
        withStore(create, async ({ store }) => {
          const [first, second] = await Promise.all([
            store.append(appendOf('todo-a', 0, [createdOf('todo-a')])),
            store.append(appendOf('todo-a', 0, [createdOf('todo-a')])),
          ]);
          const results = [first, second];
          assertSame(
            results.map((result) => result.kind).sort(),
            ['appended', 'conflict'],
            'one appended, one conflict',
          );
          const loser = results.find((result) => result.kind === 'conflict');
          assertSame(
            loser,
            { kind: 'conflict', currentSeq: 1 },
            'the loser sees the winner',
          );
          assertSame(
            seqsOf(await store.load(orderOf('todo-a'))),
            [1],
            'one event stored',
          );
        }),
    );

    runner.it(
      'appends two concurrent appenders on different orders with distinct global sequences',
      () =>
        withStore(create, async ({ store }) => {
          const [a, b] = await Promise.all([
            store.append(appendOf('todo-a', 0, [createdOf('todo-a')])),
            store.append(appendOf('todo-b', 0, [createdOf('todo-b')])),
          ]);
          const globals = [...appended(a), ...appended(b)].map(
            (stored) => stored.globalSeq,
          );
          assertSame(
            new Set(globals).size,
            2,
            'distinct global sequence numbers',
          );
          assertSame(
            (await store.feed(0, 10)).length,
            2,
            'both orders are in the feed',
          );
        }),
    );

    runner.it(
      'queues an append behind a slow transaction body without interleaving',
      () =>
        withStore(create, async ({ store }) => {
          const hold = gateOf();
          const slow = store.transaction(async (tx) => {
            await tx.append(appendOf('todo-a', 0, [createdOf('todo-a')]));
            await hold.wait;
            return 'slow done';
          });
          const queued = store.append(appendOf('todo-a', 1, [jobClaimed()]));
          hold.open();
          const [value, queuedResult] = await Promise.all([slow, queued]);
          assertSame(value, 'slow done', 'the transaction finished');
          assertSame(
            seqsOf(appended(queuedResult)),
            [2],
            'the queued append runs after the transaction, at the next sequence',
          );
          assertSame(
            seqsOf(await store.load(orderOf('todo-a'))),
            [1, 2],
            'no interleaving',
          );
        }),
    );

    runner.it(
      'appends one of two concurrent commands with the same commandId and replays the other',
      () =>
        withStore(create, async ({ store }) => {
          const same = (): AppendInput =>
            appendOf('todo-a', 0, [createdOf('todo-a')], {
              commandId: 'create-same',
            });
          const results = await Promise.all([
            store.append(same()),
            store.append(same()),
          ]);
          assertSame(
            results.map((result) => result.kind).sort(),
            ['appended', 'replayed'],
            'one appended, one replayed',
          );
          assertSame(
            seqsOf(await store.load(orderOf('todo-a'))),
            [1],
            'the command wrote once',
          );
        }),
    );
  });
};
