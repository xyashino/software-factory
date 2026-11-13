import {
  blobRefSchema,
  workerIdSchema,
  commitShaSchema,
  cycleIdSchema,
  jobIdSchema,
  orderIdOf,
  projectIdSchema,
  questionIdSchema,
  resumeIdSchema,
  stationIdSchema,
  todoIdSchema,
} from '../../ids';
import {
  type LineSnapshot,
  type Station,
  lineSnapshotSchema,
} from '../../line/snapshot';
import type { OrderEvent, StoredEvent } from '../events';
import { evolve } from '../evolve';
import type { WorkOrderState } from '../state';

type Ev<T extends OrderEvent['type']> = Extract<OrderEvent, { type: T }>;
type Fields<T extends OrderEvent['type']> = Omit<Ev<T>, 'type'>;

const hex = (n: number, width: number): string =>
  n.toString(16).padStart(width, '0');
const ulid = (letter: string, n: number): string =>
  letter + n.toString().padStart(25, '0');

export const cycleIdOf = (n: number) => cycleIdSchema.parse(ulid('C', n));
export const jobIdOf = (n: number) => jobIdSchema.parse(ulid('J', n));
export const workerIdOf = (n: number) => workerIdSchema.parse(ulid('K', n));
export const resumeIdOf = (n: number) => resumeIdSchema.parse(ulid('R', n));
export const questionIdOf = (n: number) => questionIdSchema.parse(ulid('Q', n));
export const commitOf = (n: number) => commitShaSchema.parse(hex(n, 40));
export const blobOf = (n: number) =>
  blobRefSchema.parse(`sha256:${hex(n, 64)}`);
export const stationOf = (id: string) => stationIdSchema.parse(id);

const operator = (id: string, extra: Partial<Station> = {}): Station => ({
  id: stationOf(id),
  kind: 'operator',
  runner: 'claude',
  requires: [],
  maxRestarts: 1,
  maxLostRestarts: 3,
  ...extra,
});

const DEFAULT_STATIONS: Station[] = [
  operator('plan'),
  operator('build', { requires: ['docker'] }),
  operator('audit', { onFail: { retry: stationOf('build'), max: 2 } }),
  {
    id: stationOf('check'),
    kind: 'inspection',
    requires: [],
    onFail: { retry: stationOf('build'), max: 1 },
    maxRestarts: 1,
    maxLostRestarts: 3,
  },
];

/** A Line snapshot that passes the schema. Defaults to plan, build, audit (verdict), check (inspection). */
export const makeLine = (
  stations: Station[] = DEFAULT_STATIONS,
): LineSnapshot =>
  lineSnapshotSchema.parse({
    snapshotVersion: 1,
    name: 'factory-default',
    hash: `sha256:${'a'.repeat(64)}`,
    stations,
  });

export const LINE = makeLine();
export const ORDER_ID = orderIdOf(
  projectIdSchema.parse('software-factory'),
  todoIdSchema.parse('v2-02-demo'),
);
const PINNED_LINE = {
  name: LINE.name,
  hash: LINE.hash,
  snapshotBlob: blobOf(9),
  snapshot: LINE,
};
const SPEC = {
  title: 'Add the core model',
  type: 'feat' as const,
  bodyBlob: blobOf(8),
  contentHash: `sha256:${'b'.repeat(64)}`,
};

export const created = (
  over: Partial<Fields<'order_created'>> = {},
): Ev<'order_created'> => ({
  type: 'order_created',
  projectId: projectIdSchema.parse('software-factory'),
  todoId: todoIdSchema.parse('v2-02-demo'),
  spec: SPEC,
  priority: 'medium',
  dependsOn: [],
  line: PINNED_LINE,
  baseBranch: 'main',
  ...over,
});

export const specUpdated = (
  over: Partial<Fields<'spec_updated'>> = {},
): Ev<'spec_updated'> => ({
  type: 'spec_updated',
  spec: SPEC,
  priority: 'high',
  dependsOn: [],
  ...over,
});

export const priorityChanged = (
  over: Partial<Fields<'priority_changed'>> = {},
): Ev<'priority_changed'> => ({
  type: 'priority_changed',
  priority: 'low',
  ...over,
});

export const cancelled = (
  over: Partial<Fields<'cancelled'>> = {},
): Ev<'cancelled'> => ({
  type: 'cancelled',
  reason: 'superseded by a newer todo',
  ...over,
});

export const jobClaimed = (
  over: Partial<Fields<'job_claimed'>> = {},
): Ev<'job_claimed'> => ({
  type: 'job_claimed',
  jobId: jobIdOf(1),
  kind: 'run_operator_station',
  workerId: workerIdOf(1),
  epoch: 1,
  cycleId: cycleIdOf(1),
  ...over,
});

export const jobLost = (
  over: Partial<Fields<'job_lost'>> = {},
): Ev<'job_lost'> => ({
  type: 'job_lost',
  jobId: jobIdOf(1),
  epoch: 1,
  reason: 'lease_expired',
  ...over,
});

export const workspaceFailed = (
  over: Partial<Fields<'workspace_failed'>> = {},
): Ev<'workspace_failed'> => ({
  type: 'workspace_failed',
  jobId: jobIdOf(1),
  stage: 'worktree',
  detail: 'worktree could not be created',
  logBlob: blobOf(7),
  ...over,
});

export const cycleStarted = (
  over: Partial<Fields<'cycle_started'>> = {},
): Ev<'cycle_started'> => ({
  type: 'cycle_started',
  cycleId: cycleIdOf(1),
  jobId: jobIdOf(1),
  stationId: stationOf('plan'),
  n: 1,
  cause: { kind: 'first' },
  baseCommit: commitOf(1),
  ...over,
});

export const cycleCompleted = (
  over: Partial<Fields<'cycle_completed'>> = {},
): Ev<'cycle_completed'> => ({
  type: 'cycle_completed',
  cycleId: cycleIdOf(1),
  artifacts: { plan: blobOf(2) },
  commit: commitOf(2),
  ...over,
});

export const verdictRecorded = (
  over: Partial<Fields<'verdict_recorded'>> = {},
): Ev<'verdict_recorded'> => ({
  type: 'verdict_recorded',
  cycleId: cycleIdOf(1),
  pass: true,
  artifacts: { review: blobOf(3) },
  commit: commitOf(3),
  ...over,
});

export const inspectionFinished = (
  over: Partial<Fields<'inspection_finished'>> = {},
): Ev<'inspection_finished'> => ({
  type: 'inspection_finished',
  cycleId: cycleIdOf(1),
  passed: true,
  results: [],
  ...over,
});

export const cycleFailed = (
  over: Partial<Fields<'cycle_failed'>> = {},
): Ev<'cycle_failed'> => ({
  type: 'cycle_failed',
  cycleId: cycleIdOf(1),
  reason: 'timed_out',
  detail: 'no output for the whole budget',
  ...over,
});

export const cycleBlocked = (
  over: Partial<Fields<'cycle_blocked'>> = {},
): Ev<'cycle_blocked'> => ({
  type: 'cycle_blocked',
  cycleId: cycleIdOf(1),
  source: 'operator',
  reason: 'operator_reported',
  detail: 'needs a decision on the schema',
  handoverBlob: blobOf(4),
  ...over,
});

export const cycleHandedOver = (
  over: Partial<Fields<'cycle_handed_over'>> = {},
): Ev<'cycle_handed_over'> => ({
  type: 'cycle_handed_over',
  cycleId: cycleIdOf(1),
  handoverBlob: blobOf(4),
  ...over,
});

export const usageRecorded = (
  over: Partial<Fields<'usage_recorded'>> = {},
): Ev<'usage_recorded'> => ({
  type: 'usage_recorded',
  cycleId: cycleIdOf(1),
  model: 'claude-sonnet-5-5',
  inputTokens: 1200,
  outputTokens: 300,
  costUsd: 0.02,
  ...over,
});

export const questionAsked = (
  over: Partial<Fields<'question_asked'>> = {},
): Ev<'question_asked'> => ({
  type: 'question_asked',
  cycleId: cycleIdOf(1),
  questionId: questionIdOf(1),
  text: 'Which table owns the lease?',
  ...over,
});

export const questionAnswered = (
  over: Partial<Fields<'question_answered'>> = {},
): Ev<'question_answered'> => ({
  type: 'question_answered',
  questionId: questionIdOf(1),
  by: 'dev',
  text: 'The orders table owns it.',
  ...over,
});

export const questionAbandoned = (
  over: Partial<Fields<'question_abandoned'>> = {},
): Ev<'question_abandoned'> => ({
  type: 'question_abandoned',
  questionId: questionIdOf(1),
  ...over,
});

export const noteLeft = (
  over: Partial<Fields<'note_left'>> = {},
): Ev<'note_left'> => ({
  type: 'note_left',
  cycleId: cycleIdOf(1),
  to: stationOf('build'),
  text: 'the plan keeps the api small',
  ...over,
});

export const nudged = (over: Partial<Fields<'nudged'>> = {}): Ev<'nudged'> => ({
  type: 'nudged',
  cycleId: cycleIdOf(1),
  by: 'dev',
  text: 'focus on the tests first',
  ...over,
});

export const andonRaised = (
  over: Partial<Fields<'andon_raised'>> = {},
): Ev<'andon_raised'> => ({
  type: 'andon_raised',
  reason: 'cycle_blocked',
  detail: 'operator reported a block',
  ...over,
});

export const resumed = (
  over: Partial<Fields<'resumed'>> = {},
): Ev<'resumed'> => ({
  type: 'resumed',
  resumeId: resumeIdOf(1),
  by: 'dev',
  mode: { kind: 'retry_station' },
  ...over,
});

export const reopened = (
  over: Partial<Fields<'reopened'>> = {},
): Ev<'reopened'> => ({
  type: 'reopened',
  resumeId: resumeIdOf(2),
  by: 'dev',
  stationId: stationOf('build'),
  ...over,
});

export const PR_URL = 'https://github.com/example/software-factory/pull/42';

export const deliveryFinished = (
  over: Partial<Fields<'delivery_finished'>> = {},
): Ev<'delivery_finished'> => ({
  type: 'delivery_finished',
  jobId: jobIdOf(1),
  prUrl: PR_URL,
  commit: commitOf(5),
  ...over,
});

export const deliveryFailed = (
  over: Partial<Fields<'delivery_failed'>> = {},
): Ev<'delivery_failed'> => ({
  type: 'delivery_failed',
  jobId: jobIdOf(1),
  detail: 'push was rejected',
  ...over,
});

export const prStateChanged = (
  over: Partial<Fields<'pr_state_changed'>> = {},
): Ev<'pr_state_changed'> => ({
  type: 'pr_state_changed',
  prUrl: PR_URL,
  state: 'merged',
  ...over,
});

/**
 * Wraps events into a Traveler: seq 1..n, `at` = seq * 1000 ms, a factory actor. Pure, so tests
 * can build any history from events alone.
 */
export const history = (...events: OrderEvent[]): StoredEvent[] =>
  events.map((event, index): StoredEvent => {
    const seq = index + 1;
    return {
      schemaVersion: 2,
      seq,
      globalSeq: seq,
      orderId: ORDER_ID,
      at: seq * 1000,
      actor: { kind: 'factory' },
      commandId: `cmd-${seq}`,
      event,
    };
  });

/** Folds a Traveler into the state it defines. Fails loudly when the history is not a Traveler. */
export const fold = (events: StoredEvent[]): WorkOrderState => {
  let state: WorkOrderState | undefined;
  for (const stored of events) {
    state = evolve(state, stored);
  }
  if (!state) throw new Error('empty history');
  return state;
};

/** A Traveler that has claimed its first job on plan and is running the first Cycle. */
export const runningPlan = (): StoredEvent[] =>
  history(created(), jobClaimed(), cycleStarted());

/** Every event type of the catalogue, with a valid sample. Keyed by type so a missing sample fails to type-check. */
export const samples: { [T in OrderEvent['type']]: Ev<T> } = {
  order_created: created(),
  spec_updated: specUpdated(),
  priority_changed: priorityChanged(),
  cancelled: cancelled(),
  job_claimed: jobClaimed(),
  job_lost: jobLost(),
  workspace_failed: workspaceFailed(),
  cycle_started: cycleStarted(),
  cycle_completed: cycleCompleted(),
  verdict_recorded: verdictRecorded(),
  inspection_finished: inspectionFinished(),
  cycle_failed: cycleFailed(),
  cycle_blocked: cycleBlocked(),
  cycle_handed_over: cycleHandedOver(),
  usage_recorded: usageRecorded(),
  question_asked: questionAsked(),
  question_answered: questionAnswered(),
  question_abandoned: questionAbandoned(),
  note_left: noteLeft(),
  nudged: nudged(),
  andon_raised: andonRaised(),
  resumed: resumed(),
  reopened: reopened(),
  delivery_finished: deliveryFinished(),
  delivery_failed: deliveryFailed(),
  pr_state_changed: prStateChanged(),
};
