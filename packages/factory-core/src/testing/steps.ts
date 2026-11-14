import type {
  BlobRef,
  CommitSha,
  CycleId,
  QuestionId,
  ResumeId,
  StationId,
} from '../ids';
import {
  blobOf,
  commitOf,
  PR_URL,
  stationOf,
  cellIdOf,
} from './event-builders';
import {
  actors,
  type ExpectedNext,
  type Outcome,
  type Scenario,
} from './harness';
import type { CommandOf, OrderCommand } from '../order/commands';
import type {
  AndonReason,
  CycleCause,
  InspectionResult,
  ResumeMode,
} from '../order/events';
import type { Next } from '../order/next';
import { nextJob } from '../order/next-job';

/** The Cycle the scenario ran last, for causes that point back at it. */
export const lastCycleOf = (scenario: Scenario): CycleId => {
  const cycle = scenario.state()?.cycles.at(-1);
  if (!cycle) throw new Error('lastCycleOf: no Cycle has run yet');
  return cycle.cycleId;
};

/** Command constructors: plain data, typed by the core's own command union. */
export const claim = (n = 1): OrderCommand => ({
  type: 'ClaimJob',
  cellId: cellIdOf(n),
});

export const startCycle = (baseCommit: CommitSha): OrderCommand => ({
  type: 'StartCycle',
  baseCommit,
});

export const completeCycle = (
  cycleId: CycleId,
  commit: CommitSha,
  artifacts: Record<string, BlobRef> = {},
): OrderCommand => ({ type: 'CompleteCycle', cycleId, artifacts, commit });

export const submitVerdict = (
  cycleId: CycleId,
  pass: boolean,
  commit?: CommitSha,
): OrderCommand => ({
  type: 'SubmitVerdict',
  cycleId,
  pass,
  artifacts: { review: blobOf(3) },
  feedbackBlob: pass ? undefined : blobOf(5),
  commit,
});

export const reportInspection = (
  cycleId: CycleId,
  passed: boolean,
  results: InspectionResult[] = [],
): OrderCommand => ({ type: 'ReportInspection', cycleId, passed, results });

export const failCycle = (
  cycleId: CycleId,
  reason: CommandOf<'FailCycle'>['reason'],
  wipCommit?: CommitSha,
): OrderCommand => ({
  type: 'FailCycle',
  cycleId,
  reason,
  detail: `the cycle ended as ${reason}`,
  wipCommit,
});

export const blockCycle = (cycleId: CycleId): OrderCommand => ({
  type: 'BlockCycle',
  cycleId,
  source: 'operator',
  reason: 'operator_reported',
  detail: 'needs a decision on the schema',
  handoverBlob: blobOf(4),
});

export const handOverCycle = (
  cycleId: CycleId,
  commit?: CommitSha,
): OrderCommand => ({
  type: 'HandOverCycle',
  cycleId,
  handoverBlob: blobOf(4),
  commit,
});

export const askQuestion = (
  cycleId: CycleId,
  text = 'Which table owns the lease?',
): OrderCommand => ({ type: 'AskQuestion', cycleId, text });

export const answerQuestion = (
  questionId: QuestionId,
  text = 'The orders table owns it.',
): OrderCommand => ({ type: 'Answer', questionId, text });

export const leaveNote = (
  cycleId: CycleId,
  to: StationId | 'supervisor',
  text = 'keep the api small',
): OrderCommand => ({ type: 'LeaveNote', cycleId, to, text });

export const expireLease = (): OrderCommand => ({ type: 'ExpireLease' });

export const releaseJob = (): OrderCommand => ({ type: 'ReleaseJob' });

export const resume = (
  mode: ResumeMode = { kind: 'retry_station' },
  extra: { grantRetries?: number; noteBlob?: BlobRef } = {},
): OrderCommand => ({ type: 'Resume', mode, ...extra });

export const reopen = (
  stationId: StationId,
  noteBlob?: BlobRef,
): OrderCommand => ({ type: 'Reopen', stationId, noteBlob });

export const reportDelivered = (commit: CommitSha): OrderCommand => ({
  type: 'ReportDelivery',
  result: { status: 'finished', prUrl: PR_URL, commit },
});

export const recordPrState = (
  state: 'open' | 'merged' | 'closed',
): OrderCommand => ({ type: 'RecordPrState', prUrl: PR_URL, state });

export const reportWorkspaceFailed = (): OrderCommand => ({
  type: 'ReportWorkspaceFailed',
  stage: 'worktree',
  detail: 'worktree could not be created',
  logBlob: blobOf(7),
});

export const reportDeliveryFailed = (): OrderCommand => ({
  type: 'ReportDelivery',
  result: { status: 'failed', detail: 'push was rejected' },
});

/** The cause of a Station job; a deliver job has none. */
export const causeOf = (next: Next): CycleCause => {
  if (next.kind !== 'job' || next.job.kind === 'deliver') {
    throw new Error(`causeOf: next is ${next.kind}, not a Station job`);
  }
  return next.job.cause;
};

/** Expected causes and jobs, written the way CORE §6 reads them. */
export const firstCause: CycleCause = { kind: 'first' };
export const retryCause = (feedbackFrom: CycleId): CycleCause => ({
  kind: 'retry',
  feedbackFrom,
});
export const restartCause = (of: CycleId): CycleCause => ({
  kind: 'restart',
  of,
});
export const handoverCause = (of: CycleId): CycleCause => ({
  kind: 'handover',
  of,
});
export const resumeCause = (resumeId: ResumeId, of?: CycleId): CycleCause =>
  of ? { kind: 'resume', of, resumeId } : { kind: 'resume', resumeId };

export const operatorJob = (
  stationId: string,
  n: number,
  cause: CycleCause,
  base: CommitSha | 'branch_base',
): Next => ({
  kind: 'job',
  job: {
    kind: 'run_operator_station',
    stationId: stationOf(stationId),
    n,
    cause,
    base,
  },
});

export const inspectionJob = (
  stationId: string,
  n: number,
  cause: CycleCause,
  base: CommitSha | 'branch_base',
): Next => ({
  kind: 'job',
  job: {
    kind: 'run_inspection',
    stationId: stationOf(stationId),
    n,
    cause,
    base,
  },
});

export const deliverJob = (base: CommitSha): Next => ({
  kind: 'job',
  job: { kind: 'deliver', base },
});

/** An Andon the Factory must raise; matched by reason, the detail text is not the rule under test. */
export const andon = (reason: AndonReason): ExpectedNext => ({
  kind: 'raise_andon',
  reason,
});

/**
 * Claims the Work order's next job and starts its Cycle on the base `nextJob` names. Returns the
 * started Outcome (chainable) and the Cycle id, which the caller needs to finish the Cycle.
 */
export const beginJob = (
  scenario: Scenario,
): { started: Outcome; cycle: CycleId; stationId: StationId } => {
  const claimed = scenario.when(claim());
  const state = claimed.state();
  const cycle = state?.activeJob?.cycleId;
  if (!state || !cycle) {
    throw new Error('beginJob: the claim did not start a Cycle');
  }
  const pending = nextJob({ ...state, activeJob: undefined });
  if (pending.kind !== 'job' || pending.job.kind === 'deliver') {
    throw new Error(`beginJob: next is ${pending.kind}, not a Station job`);
  }
  const base =
    pending.job.base === 'branch_base' ? commitOf(1) : pending.job.base;
  return {
    started: claimed.and(startCycle(base), actors.cell(1)),
    cycle,
    stationId: pending.job.stationId,
  };
};

/** The blobs a Station of the Line must produce, one per declared artifact. */
const declaredArtifacts = (
  outcome: Outcome,
  stationId: StationId,
): Record<string, BlobRef> => {
  const station = outcome
    .state()
    ?.line.stations.find((candidate) => candidate.id === stationId);
  return Object.fromEntries(
    (station?.artifacts ?? []).map((key) => [key, blobOf(7)]),
  );
};

/** Runs the next operator Station to a clean pass that checkpoints `commit`. */
// Each step below runs one job to its end and applies the result, so the next step sees it.

/**
 * Runs the next operator Station to a clean pass that checkpoints commit `commit`. It produces every
 * artifact the Line declares for the Station, so the caller only names the commit.
 */
export const passOperator = (scenario: Scenario, commit: number): Outcome => {
  const { started, cycle, stationId } = beginJob(scenario);
  const artifacts = declaredArtifacts(started, stationId);
  return started
    .and(
      completeCycle(cycle, commitOf(commit), artifacts),
      actors.operator(cycle),
    )
    .apply();
};

/** Runs the next verdict Station; a pass may checkpoint commit `commit`. */
export const judge = (
  scenario: Scenario,
  pass: boolean,
  commit?: number,
): Outcome => {
  const { started, cycle } = beginJob(scenario);
  const sha = commit === undefined ? undefined : commitOf(commit);
  return started
    .and(submitVerdict(cycle, pass, sha), actors.operator(cycle))
    .apply();
};

/** Runs the next Inspection; `passed` says whether the gate is green. */
export const inspect = (scenario: Scenario, passed: boolean): Outcome => {
  const { started, cycle } = beginJob(scenario);
  return started.and(reportInspection(cycle, passed), actors.cell(1)).apply();
};

/** Runs the next operator Station into a failure of `reason`. */
export const failOperator = (
  scenario: Scenario,
  reason: CommandOf<'FailCycle'>['reason'],
): Outcome => {
  const { started, cycle } = beginJob(scenario);
  return started.and(failCycle(cycle, reason), actors.cell(1)).apply();
};

/** The Factory raises the Andon that `nextJob` asks for, as the runtime does (CORE §5.3). */
export const raiseAndon = (scenario: Scenario): Scenario => {
  const state = scenario.state();
  if (!state) throw new Error('raiseAndon: the Work order does not exist');
  const next = nextJob(state);
  if (next.kind !== 'raise_andon') {
    throw new Error(`raiseAndon: nextJob is ${next.kind}, not an Andon`);
  }
  return scenario.append({
    type: 'andon_raised',
    reason: next.reason,
    detail: next.detail,
  });
};

/** Runs the next operator Station until the Operator blocks it. */
export const blockOperator = (scenario: Scenario): Outcome => {
  const { started, cycle } = beginJob(scenario);
  return started.and(blockCycle(cycle), actors.operator(cycle)).apply();
};
