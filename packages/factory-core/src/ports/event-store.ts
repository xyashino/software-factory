import type { OrderId, PlanId } from '../ids';
import type { Actor, OrderEvent, StoredEvent } from '../order/events';
import type { OrderProjection } from '../order/projection';
import type { PlanEvent, StoredPlanEvent } from '../plan/events';
import type { PlanProjection } from '../plan/projection';

export interface AppendInput {
  orderId: OrderId;
  commandId: string;
  expectedSeq: number; // the last seq the caller folded
  actor: Actor;
  epoch?: number;
  at: number; // ms, the Factory clock when the command ran; stamped on every event it appends
  events: OrderEvent[];
  projection: OrderProjection; // core `toProjection` of the post-append state, computed by the caller
  response: unknown; // what to return on an idempotent replay
}

/** One append to an Order Plan stream. Same rules as `AppendInput`, plan-shaped. */
export interface PlanAppendInput {
  planId: PlanId;
  commandId: string;
  expectedSeq: number;
  actor: Actor;
  epoch?: number;
  at: number;
  events: PlanEvent[];
  projection: PlanProjection; // core `toPlanProjection` of the post-append state
  response: unknown;
}

export type AppendResult =
  | { kind: 'appended'; events: StoredEvent[] }
  | { kind: 'replayed'; response: unknown } // commandId already seen
  | { kind: 'conflict'; currentSeq: number }; // someone appended first: reload and decide again

export type PlanAppendResult =
  | { kind: 'appended'; events: StoredPlanEvent[] }
  | { kind: 'replayed'; response: unknown }
  | { kind: 'conflict'; currentSeq: number };

/** The synchronous part of the store, usable inside `EventStore.transaction`. */
export interface StoreTx {
  load(orderId: OrderId): Promise<StoredEvent[]>;
  append(input: AppendInput): Promise<AppendResult>;
  loadPlan(planId: PlanId): Promise<StoredPlanEvent[]>;
  appendPlan(input: PlanAppendInput): Promise<PlanAppendResult>;
}

export interface EventStore {
  /** All events of a Work order (its Traveler), upcast to the current schema. */
  load(orderId: OrderId): Promise<StoredEvent[]>;
  /** All events of an Order Plan (its Traveler), in seq order. */
  loadPlan(planId: PlanId): Promise<StoredPlanEvent[]>;
  /** The same as `append`, for a plan stream: one transaction with its `plans` row. */
  appendPlan(input: PlanAppendInput): Promise<PlanAppendResult>;
  /**
   * The response stored for a command that already ran. Read before `decide`,
   * because a replayed command may no longer be decidable against the current state.
   */
  response(commandId: string): Promise<{ response: unknown } | undefined>;
  /** Factory-wide feed from a global position (stream, export, projections rebuild). */
  feed(afterGlobalSeq: number, limit: number): Promise<StoredEvent[]>;
  /**
   * Atomically: check idempotency, check expectedSeq, insert events, update projections,
   * store the command result.
   */
  append(input: AppendInput): Promise<AppendResult>;
  /** Runs `fn` inside one write transaction (claim, reaper, continuation). */
  transaction<T>(fn: (tx: StoreTx) => Promise<T>): Promise<T>;
}
