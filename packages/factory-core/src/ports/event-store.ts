import type { OrderId } from '../ids';
import type { Actor, OrderEvent, StoredEvent } from '../order/events';
import type { OrderProjection } from '../order/projection';

export interface AppendInput {
  orderId: OrderId;
  commandId: string;
  expectedSeq: number; // the last seq the caller folded
  actor: Actor;
  epoch?: number;
  events: OrderEvent[];
  projection: OrderProjection; // core `toProjection` of the post-append state, computed by the caller
  response: unknown; // what to return on an idempotent replay
}

export type AppendResult =
  | { kind: 'appended'; events: StoredEvent[] }
  | { kind: 'replayed'; response: unknown } // commandId already seen
  | { kind: 'conflict'; currentSeq: number }; // someone appended first: reload and decide again

/** The synchronous part of the store, usable inside `EventStore.transaction` (STORAGE §3.1). */
export interface StoreTx {
  load(orderId: OrderId): Promise<StoredEvent[]>;
  append(input: AppendInput): Promise<AppendResult>;
}

export interface EventStore {
  /** All events of a Work order (its Traveler), upcast to the current schema. */
  load(orderId: OrderId): Promise<StoredEvent[]>;
  /** Factory-wide feed from a global position (stream, export, projections rebuild). */
  feed(afterGlobalSeq: number, limit: number): Promise<StoredEvent[]>;
  /**
   * Atomically: check idempotency, check expectedSeq, insert events, update projections,
   * store the command result (STORAGE §3).
   */
  append(input: AppendInput): Promise<AppendResult>;
  /** Runs `fn` inside one write transaction (claim, reaper, continuation). STORAGE §3.1. */
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
}
