import type { Actor, OrderEvent } from '@repo/factory-core/order/events';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { PlanId } from '@repo/factory-core/ids';
import { planIdOf } from '@repo/factory-core/ids';
import type { PlanCommand } from '@repo/factory-core/plan/commands';
import { decidePlan } from '@repo/factory-core/plan/decide';
import type {
  MemberState,
  PlanEvent,
  StoredPlanEvent,
} from '@repo/factory-core/plan/events';
import { evolvePlan } from '@repo/factory-core/plan/evolve';
import { planNextJob } from '@repo/factory-core/plan/next-job';
import {
  toPlanProjection,
  type PlanProjection,
} from '@repo/factory-core/plan/projection';
import type { PlanState } from '@repo/factory-core/plan/state';
import { refusal, RuntimeError, unavailable } from './errors';
import { orderLocks } from './order-lock';
import type { RuntimePorts } from './ports';
import { decideContext } from './state';

/** One command on a plan stream (CORE §12.3), as the runtime receives it. */
export interface PlanCommandRequest {
  planId: PlanId;
  commandId: string;
  command: PlanCommand;
  actor: Actor;
  /** The epoch the caller claims to hold; `decidePlan` refuses it unless it is the active job's. */
  epoch?: number;
}

/** What a plan command stores as its idempotent response: the events it appended. */
export interface PlanCommandResult {
  events: PlanEvent[];
}

export interface PlanCommands {
  /** Runs a plan command through the loop: load, fold, decide, project, append (STORAGE §3). */
  submit(request: PlanCommandRequest): Promise<PlanCommandResult>;
  /**
   * Reports a Work order's new state to its plan (CORE §12.7). Called after the order's command
   * committed. Only the events that change a member's state matter; a refusal (no change, no plan
   * yet) is not an error here: the start-up reconcile repairs what a crash left behind.
   */
  reportMember(
    row: OrderProjection,
    eventTypes: readonly OrderEvent['type'][],
  ): Promise<void>;
}

/** The events that change a member's state as the plan hears it (CORE §12.7). */
const MEMBER_EVENTS: ReadonlySet<OrderEvent['type']> = new Set([
  'delivery_finished',
  'pr_state_changed',
  'cancelled',
]);

/** The member state a Work order row implies (CORE §12.3). A merged PR is merged, whatever the status says. */
export const memberStateOf = (
  row: Pick<OrderProjection, 'status' | 'prState'>,
): MemberState => {
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'merged' || row.prState === 'merged') return 'merged';
  if (row.prState === 'closed') return 'closed';
  if (row.status === 'delivered') return 'delivered';
  return 'open';
};

/** A command fully decided: the events to append and the projection they leave. */
interface Prepared {
  request: PlanCommandRequest;
  expectedSeq: number;
  events: PlanEvent[];
  projection: PlanProjection;
}

const fold = (
  state: PlanState | undefined,
  stored: readonly StoredPlanEvent[],
): PlanState | undefined =>
  stored.reduce<PlanState | undefined>(evolvePlan, state);

/**
 * The plan command loop (CORE §12.3). A replayed command id returns its stored response before any
 * decision. A conflict reloads and decides again, up to `commandAttempts`. `onCommit` runs after each
 * append, as it does for Work orders.
 */
export const createPlanCommands = (
  ports: RuntimePorts,
  onCommit: () => void,
): PlanCommands => {
  const locks = orderLocks();
  const { clock, ids, config, writer } = ports;

  const prepare = (
    request: PlanCommandRequest,
    stored: StoredPlanEvent[],
  ): Prepared => {
    const now = clock.now();
    const before = fold(undefined, stored);
    const lastSeq = stored.at(-1)?.seq ?? 0;
    const createdAt = stored[0]?.at ?? now;
    const decision = decidePlan(
      before,
      request.command,
      decideContext(
        {
          now,
          ids,
          actor: request.actor,
          ...(request.epoch !== undefined ? { epoch: request.epoch } : {}),
        },
        new Map(),
      ),
    );
    if (!decision.ok) throw refusal(decision.error);

    const events: PlanEvent[] = [];
    let seq = lastSeq;
    let state = before;
    const append = (event: PlanEvent): void => {
      seq += 1;
      const envelope: StoredPlanEvent = {
        schemaVersion: 2,
        seq,
        globalSeq: seq,
        planId: request.planId,
        at: now,
        actor: request.actor,
        commandId: request.commandId,
        ...(request.epoch !== undefined ? { epoch: request.epoch } : {}),
        event,
      };
      state = evolvePlan(state, envelope);
      events.push(event);
    };
    for (const event of decision.value) append(event);
    // `raise_andon` is appended by the runtime, as for Work orders (CORE §12.3, nextJob rows 4 and 5).
    const pending = state ? planNextJob(state) : undefined;
    if (pending?.kind === 'raise_andon') {
      append({
        type: 'andon_raised',
        reason: pending.reason,
        detail: pending.detail,
      });
    }
    if (!state) throw new Error('a decided plan command left no state');
    return {
      request,
      expectedSeq: lastSeq,
      events,
      projection: toPlanProjection(state, {
        lastSeq: seq,
        createdAt,
        updatedAt: now,
        next: planNextJob(state),
      }),
    };
  };

  const submit = async (
    request: PlanCommandRequest,
  ): Promise<PlanCommandResult> => {
    writer.assertHeld();
    const replay = await ports.events.response(request.commandId);
    if (replay) return replay.response as PlanCommandResult;
    return locks.run(request.planId, async () => {
      for (let attempt = 1; attempt <= config.commandAttempts; attempt += 1) {
        const stored = await ports.events.loadPlan(request.planId);
        const prepared = prepare(request, stored);
        const outcome = await ports.events.appendPlan({
          planId: request.planId,
          commandId: request.commandId,
          expectedSeq: prepared.expectedSeq,
          actor: request.actor,
          ...(request.epoch !== undefined ? { epoch: request.epoch } : {}),
          at: clock.now(),
          events: prepared.events,
          projection: prepared.projection,
          response: { events: prepared.events } satisfies PlanCommandResult,
        });
        if (outcome.kind === 'appended') {
          onCommit();
          return { events: prepared.events };
        }
        if (outcome.kind === 'replayed')
          return outcome.response as PlanCommandResult;
      }
      throw unavailable();
    });
  };

  const reportMember = async (
    row: OrderProjection,
    eventTypes: readonly OrderEvent['type'][],
  ): Promise<void> => {
    if (
      row.plan === null ||
      !eventTypes.some((type) => MEMBER_EVENTS.has(type))
    )
      return;
    try {
      await submit({
        planId: planIdOf(row.projectId, row.plan),
        commandId: `${row.orderId}:${row.lastSeq}:plan`,
        command: {
          type: 'RecordMemberState',
          orderId: row.orderId,
          state: memberStateOf(row),
        },
        actor: { kind: 'factory' },
      });
    } catch (error) {
      if (!(error instanceof RuntimeError)) throw error;
    }
  };

  return { submit, reportMember };
};
