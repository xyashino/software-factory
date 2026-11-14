import {
  cellIdSchema,
  commitShaSchema,
  type CommitSha,
  jobIdSchema,
  orderIdOf,
  planIdOf,
  planSlugSchema,
  projectIdSchema,
  resumeIdSchema,
  todoIdSchema,
  type OrderId,
  type PlanId,
  type PlanSlug,
  type ProjectId,
  type TodoId,
} from '../../ids';
import type { Actor } from '../../order/events';
import type { DecideContext } from '../../order/commands';
import type { PlanCommand } from '../commands';
import type { PlanEvent, StoredPlanEvent } from '../events';
import { decidePlan, type PlanDecideContext } from '../decide';
import { evolvePlan } from '../evolve';
import type { PlanState } from '../state';
import type { DomainError } from '../../order/commands';

export const PROJECT: ProjectId = projectIdSchema.parse('software-factory');
export const SLUG: PlanSlug = planSlugSchema.parse('xyz');
export const PLAN_ID: PlanId = planIdOf(PROJECT, SLUG);
export const COMMIT: CommitSha = commitShaSchema.parse('a'.repeat(40));
export const PR_URL = 'https://github.com/example/repo/pull/7';

/** A 26-character Crockford id made from a number, so tests read the same every run. */
export const ulid = (n: number): string => n.toString().padStart(26, '0');
export const CELL = cellIdSchema.parse(ulid(900));
export const OTHER_CELL = cellIdSchema.parse(ulid(901));
export const JOB = (n: number) => jobIdSchema.parse(ulid(100 + n));
export const RESUME = resumeIdSchema.parse(ulid(800));

export const todoOf = (name: string): TodoId => todoIdSchema.parse(name);
export const orderOf = (name: string): OrderId =>
  orderIdOf(PROJECT, todoOf(name));

export const FACTORY: Actor = { kind: 'factory' };
export const SUPERVISOR: Actor = { kind: 'supervisor', name: 'alice' };
export const cellActor = (cellId = CELL): Actor => ({ kind: 'cell', cellId });

/** A stored plan event at a sequence number. `at` grows with `seq`, so Andons get a time. */
export const stored = (
  seq: number,
  event: PlanEvent,
  at = seq * 10,
): StoredPlanEvent => ({
  schemaVersion: 2,
  seq,
  globalSeq: seq,
  planId: PLAN_ID,
  at,
  actor: FACTORY,
  commandId: `cmd-${seq}`,
  event,
});

/** The events of a plan that has been created and has one root member `wo-1`. */
export const created = (): PlanEvent => ({
  type: 'plan_created',
  projectId: PROJECT,
  slug: SLUG,
  branch: 'feat/xyz',
  baseBranch: 'main',
});

export const member = (name: string, after?: string): PlanEvent => ({
  type: 'plan_member_added',
  orderId: orderOf(name),
  todoId: todoOf(name),
  ...(after === undefined ? {} : { after: orderOf(after) }),
});

/** Folds events into a state. Throws when a history is not a valid plan. */
export const fold = (events: PlanEvent[]): PlanState => {
  let state: PlanState | undefined;
  events.forEach((event, index) => {
    state = evolvePlan(state, stored(index + 1, event));
  });
  if (!state) throw new Error('empty history');
  return state;
};

/** A plan context: the actor, the epoch the caller claims, and deterministic ids. */
export const ctxOf = (
  actor: Actor = FACTORY,
  epoch?: number,
): PlanDecideContext => {
  let n = 0;
  const ctx: DecideContext = {
    now: 0,
    ids: { next: () => ulid(1000 + n++) },
    actor,
    blobs: { exists: () => true, size: () => 0 },
    ...(epoch === undefined ? {} : { epoch }),
  };
  return ctx;
};

export type Outcome =
  | { ok: true; events: PlanEvent[]; state: PlanState | undefined }
  | { ok: false; error: DomainError };

/** Decides a command and folds the events into the state. The caller's history is never changed. */
export const run = (
  state: PlanState | undefined,
  command: PlanCommand,
  ctx: PlanDecideContext = ctxOf(),
): Outcome => {
  const decided = decidePlan(state, command, ctx);
  if (!decided.ok) return { ok: false, error: decided.error };
  let next: PlanState | undefined = state;
  decided.value.forEach((event, index) => {
    const seq = (state?.members.length ?? 0) + 1000 + index;
    next = evolvePlan(next, stored(seq, event));
  });
  return { ok: true, events: decided.value, state: next };
};

/** Asserts a refusal and returns its error, for readable expectations. */
export const refused = (outcome: Outcome): DomainError => {
  if (outcome.ok)
    throw new Error(
      `expected a refusal, got ${JSON.stringify(outcome.events)}`,
    );
  return outcome.error;
};

/** The plan after `created` and the three members wo-1 <- wo-2 <- wo-3. */
export const chainOf3 = (): PlanEvent[] => [
  created(),
  member('wo-1'),
  member('wo-2', 'wo-1'),
  member('wo-3', 'wo-2'),
];

export { type OrderId, type TodoId };
