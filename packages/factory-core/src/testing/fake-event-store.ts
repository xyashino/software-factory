import type { OrderId } from '../ids';
import {
  type OrderEvent,
  type StoredEvent,
  storedEventSchema,
} from '../order/events';
import type { OrderProjection } from '../order/projection';
import type {
  AppendInput,
  AppendResult,
  EventStore,
  StoreTx,
} from '../ports/event-store';

/** The in-memory `EventStore`, plus the `orders` read the contract suite needs. */
export type FakeEventStore = EventStore & {
  orders(): Promise<OrderProjection[]>;
};

/** What a command stored, so a replay returns the same response. */
interface CommandRecord {
  orderId: OrderId;
  response: unknown;
  firstSeq: number;
  lastSeq: number;
  at: number;
}

/** The whole store as data. Transactions work on a copy and replace the committed one on commit. */
interface Snapshot {
  events: StoredEvent[];
  orders: Map<OrderId, OrderProjection>;
  commands: Map<string, CommandRecord>;
}

const emptySnapshot = (): Snapshot => ({
  events: [],
  orders: new Map(),
  commands: new Map(),
});

const copyOf = (snapshot: Snapshot): Snapshot => ({
  events: [...snapshot.events],
  orders: new Map(snapshot.orders),
  commands: new Map(snapshot.commands),
});

/** Runs async sections one at a time, in arrival order. Never rejects, so a failure does not block the queue. */
const exclusively = (): (<T>(section: () => Promise<T>) => Promise<T>) => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(section: () => Promise<T>): Promise<T> => {
    const result = tail.then(section);
    tail = result.catch(() => undefined);
    return result;
  };
};

const byOrderId = (a: OrderProjection, b: OrderProjection): number => {
  if (a.orderId === b.orderId) return 0;
  return a.orderId < b.orderId ? -1 : 1;
};

const envelopeOf = (
  input: AppendInput,
  event: OrderEvent,
  seq: number,
  globalSeq: number,
): StoredEvent => {
  const envelope = {
    schemaVersion: 2,
    seq,
    globalSeq,
    orderId: input.orderId,
    at: input.at,
    actor: input.actor,
    commandId: input.commandId,
    ...(input.epoch !== undefined ? { epoch: input.epoch } : {}),
    event,
  };
  return storedEventSchema.parse(envelope);
};

/**
 * One append on `snapshot` (STORAGE §3): idempotency, then optimistic concurrency, then the facts,
 * the projection row and the command record. Refusals write nothing. Validates before it writes.
 */
const applyAppend = (snapshot: Snapshot, input: AppendInput): AppendResult => {
  const replay = snapshot.commands.get(input.commandId);
  if (replay) return { kind: 'replayed', response: replay.response };
  const currentSeq = snapshot.orders.get(input.orderId)?.lastSeq ?? 0;
  if (currentSeq !== input.expectedSeq) {
    return { kind: 'conflict', currentSeq };
  }
  const lastSeq = input.expectedSeq + input.events.length;
  if (input.projection.lastSeq !== lastSeq) {
    throw new Error(
      `projection lastSeq ${input.projection.lastSeq} must equal the last appended seq ${lastSeq}`,
    );
  }
  const firstGlobal = snapshot.events.length + 1;
  const stored = input.events.map((event, index) =>
    envelopeOf(
      input,
      event,
      input.expectedSeq + index + 1,
      firstGlobal + index,
    ),
  );
  snapshot.events.push(...stored);
  snapshot.orders.set(input.orderId, input.projection);
  snapshot.commands.set(input.commandId, {
    orderId: input.orderId,
    response: input.response,
    firstSeq: input.expectedSeq + 1,
    lastSeq,
    at: input.at,
  });
  return { kind: 'appended', events: stored };
};

const loadFrom = (snapshot: Snapshot, orderId: OrderId): StoredEvent[] =>
  snapshot.events.filter((stored) => stored.orderId === orderId);

/**
 * An `EventStore` in memory. Writes (`append`, `transaction`) run one at a time. A transaction
 * works on a copy: its writes become visible to readers only when it returns, and a throw discards
 * them. Readers see the committed state only.
 */
export const fakeEventStore = (): FakeEventStore => {
  let committed = emptySnapshot();
  const exclusive = exclusively();

  const transaction = <T>(fn: (tx: StoreTx) => Promise<T>): Promise<T> =>
    exclusive(async () => {
      const staged = copyOf(committed);
      const tx: StoreTx = {
        load: async (orderId) => loadFrom(staged, orderId),
        append: async (input) => applyAppend(staged, input),
      };
      const value = await fn(tx);
      committed = staged;
      return value;
    });

  return {
    load: async (orderId) => loadFrom(committed, orderId),
    response: async (commandId) => {
      const record = committed.commands.get(commandId);
      return record ? { response: record.response } : undefined;
    },
    feed: async (afterGlobalSeq, limit) =>
      committed.events
        .filter((stored) => stored.globalSeq > afterGlobalSeq)
        .slice(0, limit),
    append: (input) => transaction((tx) => tx.append(input)),
    transaction,
    orders: async () => [...committed.orders.values()].sort(byOrderId),
  };
};
