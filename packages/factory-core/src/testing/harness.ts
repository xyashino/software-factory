import type { BlobRef, CycleId } from '../ids';
import type {
  DecideContext,
  DomainError,
  OrderCommand,
} from '../order/commands';
import { decide } from '../order/decide';
import type { Decision } from '../order/decide-guards';
import type {
  Actor,
  AndonReason,
  OrderEvent,
  StoredEvent,
} from '../order/events';
import { evolve } from '../order/evolve';
import type { Next } from '../order/next';
import { nextJob } from '../order/next-job';
import type { WorkOrderState } from '../order/state';
import { history, ORDER_ID, cellIdOf } from './event-builders';
import {
  fakeBlobs,
  fakeClock,
  fakeIds,
  type FakeBlobs,
  type FakeClock,
  type FakeIds,
} from './fakes';

/** The Actors a scenario can speak as. */
export const actors = {
  factory: { kind: 'factory' } satisfies Actor,
  supervisor: (name = 'dev'): Actor => ({ kind: 'supervisor', name }),
  cell: (n = 1): Actor => ({ kind: 'cell', cellId: cellIdOf(n) }),
  operator: (cycleId: CycleId, n = 1): Actor => ({
    kind: 'operator',
    cellId: cellIdOf(n),
    cycleId,
  }),
};

/** An expected Next. An Andon without `detail` matches on its reason alone. */
export type ExpectedNext =
  Next | { kind: 'raise_andon'; reason: AndonReason; detail?: string };

export interface GivenOptions {
  /** Blobs the store does not hold: a command citing one is refused as invalid. */
  missingBlobs?: readonly BlobRef[];
}

/** Stable key order and no undefined, so equal values compare equal however they were built. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, field]) => field !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, field]) => [key, canonical(field)]),
    );
  }
  return value;
};

const show = (value: unknown): string =>
  JSON.stringify(canonical(value), null, 2);

/** Plain deep equality on data, reported as a diff. Throws a plain Error so vitest shows it. */
export const assertSame = (
  actual: unknown,
  expected: unknown,
  label: string,
): void => {
  const got = show(actual);
  const want = show(expected);
  if (got !== want) {
    throw new Error(`${label}\n--- expected\n${want}\n--- actual\n${got}`);
  }
};

/** Compares `nextJob(state)` with `expected`; an Andon without a detail is matched by reason. */
const assertNext = (
  state: WorkOrderState,
  expected: ExpectedNext,
  label: string,
): void => {
  const actual = nextJob(state);
  if (
    expected.kind === 'raise_andon' &&
    expected.detail === undefined &&
    actual.kind === 'raise_andon'
  ) {
    assertSame(
      { kind: actual.kind, reason: actual.reason },
      { kind: expected.kind, reason: expected.reason },
      label,
    );
    return;
  }
  assertSame(actual, expected, label);
};

/** Folds stored events into a state; undefined before `order_created`. */
const foldAll = (
  stored: readonly StoredEvent[],
): WorkOrderState | undefined => {
  let state: WorkOrderState | undefined;
  for (const envelope of stored) {
    state = evolve(state, envelope);
  }
  return state;
};

const FACTORY_ACTOR: Actor = { kind: 'factory' };

/**
 * A Work order under test. It holds a Traveler (events with seq, time and actor), a fake clock, fake
 * ids and fake blobs. Commands run through `decide`; accepted events are kept only by `and`, so a
 * `when` never changes the Work order unless the scenario chains on it.
 */
export class Scenario {
  private readonly stored: StoredEvent[];
  private readonly clock: FakeClock;
  private readonly ids: FakeIds;
  private readonly blobs: FakeBlobs;
  private folded: WorkOrderState | undefined;
  private foldedCount = 0;

  constructor(events: readonly OrderEvent[], options: GivenOptions = {}) {
    this.stored = history(...events);
    this.clock = fakeClock((this.stored.length + 1) * 1000);
    this.ids = fakeIds();
    this.blobs = fakeBlobs().missing(...(options.missingBlobs ?? []));
  }

  /** The state the Traveler folds to, or undefined before the Work order exists. */
  state(): WorkOrderState | undefined {
    for (; this.foldedCount < this.stored.length; this.foldedCount += 1) {
      const envelope = this.stored[this.foldedCount];
      if (envelope) this.folded = evolve(this.folded, envelope);
    }
    return this.folded;
  }

  /** The Traveler so far: every stored event, in order. */
  events(): StoredEvent[] {
    return [...this.stored];
  }

  /** Runs a command as `by`. `epoch` defaults to the active job's epoch, as a live cell would hold. */
  when(
    command: OrderCommand,
    by: Actor = FACTORY_ACTOR,
    options: { epoch?: number } = {},
  ): Outcome {
    const state = this.state();
    const epoch = options.epoch ?? state?.activeJob?.epoch;
    const now = this.clock.now();
    this.clock.advance(1000);
    const context: DecideContext = {
      now,
      ids: this.ids,
      actor: by,
      epoch,
      blobs: this.blobs,
    };
    const result: Decision = decide(state, command, context);
    const fenced = by.kind === 'cell' || by.kind === 'operator';
    const first = this.stored.length + 1;
    // One command, one commandId: every event it emits shares it (CORE §3.1).
    const envelopes: StoredEvent[] = result.ok
      ? result.value.map((event, index) => {
          const seq = first + index;
          return {
            schemaVersion: 2,
            seq,
            globalSeq: seq,
            orderId: ORDER_ID,
            at: now,
            actor: by,
            commandId: `cmd-${first}`,
            ...(fenced && epoch !== undefined ? { epoch } : {}),
            event,
          };
        })
      : [];
    return new Outcome(this, command, result, envelopes);
  }

  /** Asserts the Work order's next Job (CORE §6). The Work order must exist. */
  nextJob(expected: ExpectedNext): this {
    const state = this.state();
    if (!state) throw new Error('nextJob: the Work order does not exist yet');
    assertNext(state, expected, 'nextJob');
    return this;
  }

  /** Appends accepted envelopes: used by `Outcome.apply` so the next command sees them. */
  commit(envelopes: readonly StoredEvent[]): void {
    this.stored.push(...envelopes);
  }

  /** Appends an event the Factory itself writes, such as `andon_raised` (CORE §5.3). */
  append(event: OrderEvent, by: Actor = FACTORY_ACTOR): this {
    const now = this.clock.now();
    this.clock.advance(1000);
    const seq = this.stored.length + 1;
    this.stored.push({
      schemaVersion: 2,
      seq,
      globalSeq: seq,
      orderId: ORDER_ID,
      at: now,
      actor: by,
      commandId: `cmd-${seq}`,
      event,
    });
    return this;
  }

  /** The Traveler with `envelopes` appended, without changing this scenario. */
  withEnvelopes(envelopes: readonly StoredEvent[]): WorkOrderState | undefined {
    return foldAll([...this.stored, ...envelopes]);
  }
}

/** The answer to one `when`: the events, or the refusal, and the way to chain on it. */
export class Outcome {
  private applied = false;

  constructor(
    private readonly scenario: Scenario,
    private readonly command: OrderCommand,
    private readonly result: Decision,
    private readonly envelopes: StoredEvent[],
  ) {}

  /** Keeps the emitted events in the Work order, so later steps of the scenario see them. */
  apply(): this {
    this.accepted();
    if (!this.applied) {
      this.scenario.commit(this.envelopes);
      this.applied = true;
    }
    return this;
  }

  /** Asserts the command was accepted and emitted exactly `expected`, in order. */
  then(expected: OrderEvent[]): this {
    const events = this.accepted();
    assertSame(events, expected, `events of ${this.command.type}`);
    return this;
  }

  /** Asserts the command was accepted and emitted these event types, in order. */
  thenTypes(types: OrderEvent['type'][]): this {
    const events = this.accepted();
    assertSame(
      events.map((event) => event.type),
      types,
      `event types of ${this.command.type}`,
    );
    return this;
  }

  /** Asserts the command was refused with `code`. */
  thenError(code: DomainError['code']): this {
    if (this.result.ok) {
      throw new Error(
        `expected ${this.command.type} to be refused with ${code}, got events ${show(this.result.value)}`,
      );
    }
    if (this.result.error.code !== code) {
      throw new Error(
        `expected ${this.command.type} to be refused with ${code}, got ${show(this.result.error)}`,
      );
    }
    return this;
  }

  /** Asserts the next Job once the emitted events are applied. */
  nextJob(expected: ExpectedNext): this {
    const state = this.state();
    if (!state) throw new Error('nextJob: the Work order does not exist');
    assertNext(state, expected, `nextJob after ${this.command.type}`);
    return this;
  }

  /** Applies the emitted events, then runs `command` on the new state (a scenario step). */
  and(
    command: OrderCommand,
    by?: Actor,
    options?: { epoch?: number },
  ): Outcome {
    this.apply();
    return this.scenario.when(command, by, options);
  }

  /** The events the command emitted. Throws when it was refused. */
  events(): OrderEvent[] {
    return this.accepted();
  }

  /** Why the command was refused, or undefined when it was accepted. Never throws. */
  refusal(): DomainError | undefined {
    return this.result.ok ? undefined : this.result.error;
  }

  /** The state after the emitted events, for follow-up assertions. */
  state(): WorkOrderState | undefined {
    this.accepted();
    return this.applied
      ? this.scenario.state()
      : this.scenario.withEnvelopes(this.envelopes);
  }

  private accepted(): OrderEvent[] {
    if (!this.result.ok) {
      throw new Error(
        `${this.command.type} was refused: ${show(this.result.error)}`,
      );
    }
    return this.result.value;
  }
}

/** Starts a scenario from events. `given([]).when(CreateOrder)` runs the very first command. */
export const given = (
  events: readonly OrderEvent[],
  options?: GivenOptions,
): Scenario => new Scenario(events, options);
