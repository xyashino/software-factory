import type { BlobRef, CycleId, StationId } from '../ids';
import { findStation, stationIndex, type Station } from '../line/snapshot';
import type { CycleCause, InspectionResult } from './events';
import { requireCycle } from './evolve-helpers';
import type { WorkOrderState } from './state';

/** Where the Worker keeps the Cycle's scratch files, relative to the worktree (PROTOCOL §4). */
const SCRATCH_DIR = '.worker';

export type CycleInput =
  | {
      kind: 'artifact';
      stationId: StationId;
      key: string;
      cycleId: CycleId;
      blob: BlobRef;
      materialiseAs: string; // relative path, e.g. `.worker/inputs/plan.plan`
    }
  | {
      kind: 'inspection';
      stationId: StationId;
      cycleId: CycleId;
      commands: string[];
    }
  | { kind: 'order'; field: 'title' | 'branch'; value: string }
  | {
      kind: 'order';
      field: 'body';
      blob: BlobRef; // the spec keeps the body as a blob, not as text
      materialiseAs: string; // relative path, `.worker/inputs/order.body`
    };

export type CycleFeedback =
  | { kind: 'verdict'; fromCycle: CycleId; blob: BlobRef }
  | {
      kind: 'inspection';
      fromCycle: CycleId;
      results: InspectionResult[];
      logBlobs: BlobRef[];
    };

/** What the prompt of one Cycle is built from (CORE §7). Paths are relative; no absolute path. */
export interface CycleContext {
  inputs: CycleInput[];
  notes: { fromStation: StationId; text: string }[];
  feedback?: CycleFeedback; // present whenever pendingFeedback targets the Station, whatever the cause
  resume?: { fromCycle?: CycleId; handoverBlob?: BlobRef; noteBlob?: BlobRef };
  handover?: { fromCycle: CycleId; handoverBlob: BlobRef };
  restart?: { of: CycleId; reason: string };
  nudges: string[]; // none at start; listed for completeness of the audit view
  priorQuestions: { question: string; answer?: string }[];
  outputs: { key: string; path: string }[];
}

const requireStation = (state: WorkOrderState, id: StationId): Station => {
  const station = findStation(state.line, id);
  if (!station) {
    throw new Error(`station ${id} is not in line ${state.line.name}`);
  }
  return station;
};

const orderInputs = (state: WorkOrderState): CycleInput[] => [
  { kind: 'order', field: 'title', value: state.spec.title },
  {
    kind: 'order',
    field: 'body',
    blob: state.spec.bodyBlob,
    materialiseAs: `${SCRATCH_DIR}/inputs/order.body`,
  },
  { kind: 'order', field: 'branch', value: state.todoId },
];

/** Artifacts and Inspection commands of the Stations that passed before this one (CORE §7). */
const earlierInputs = (
  state: WorkOrderState,
  stationId: StationId,
): CycleInput[] => {
  const index = stationIndex(state.line, stationId) ?? 0;
  return state.line.stations
    .slice(0, index)
    .flatMap((station): CycleInput[] => {
      const cycleId = state.lastPassed[station.id];
      if (!cycleId) return [];
      if (station.kind === 'inspection') {
        return [
          {
            kind: 'inspection',
            stationId: station.id,
            cycleId,
            commands: station.exec ?? [],
          },
        ];
      }
      const cycle = requireCycle(state, cycleId);
      return Object.entries(cycle.artifacts).map(([key, blob]): CycleInput => ({
        kind: 'artifact',
        stationId: station.id,
        key,
        cycleId,
        blob,
        materialiseAs: `${SCRATCH_DIR}/inputs/${station.id}.${key}`,
      }));
    });
};

const notesFor = (
  state: WorkOrderState,
  stationId: StationId,
): CycleContext['notes'] =>
  state.notes
    .filter((note) => note.to === stationId)
    .map((note) => ({ fromStation: note.fromStation, text: note.text }));

/** The failure a retry must fix: a verdict's feedback, or an Inspection's results and logs. */
const feedbackFor = (
  state: WorkOrderState,
  stationId: StationId,
): CycleFeedback | undefined => {
  const pending = state.pendingFeedback;
  if (!pending || pending.forStation !== stationId) return undefined;
  const source = requireCycle(state, pending.fromCycle);
  if (source.outcome === 'verdict_fail' && source.feedbackBlob) {
    return {
      kind: 'verdict',
      fromCycle: source.cycleId,
      blob: source.feedbackBlob,
    };
  }
  if (source.outcome === 'inspection_fail') {
    return {
      kind: 'inspection',
      fromCycle: source.cycleId,
      results: source.inspectionResults,
      logBlobs: source.inspectionResults.map((result) => result.logBlob),
    };
  }
  return undefined;
};

/** The resume, handover and restart sections, by the cause of this Cycle (CORE §5.3, §7). */
const causeSections = (
  state: WorkOrderState,
  cause: CycleCause,
): Pick<CycleContext, 'resume' | 'handover' | 'restart'> => {
  switch (cause.kind) {
    case 'first':
    case 'retry':
      return {};
    case 'resume': {
      const from = cause.of ? requireCycle(state, cause.of) : undefined;
      const noteBlob = state.pendingResume?.noteBlob;
      return {
        resume: {
          ...(from ? { fromCycle: from.cycleId } : {}),
          ...(from?.handoverBlob ? { handoverBlob: from.handoverBlob } : {}),
          ...(noteBlob ? { noteBlob } : {}),
        },
      };
    }
    case 'handover': {
      const from = requireCycle(state, cause.of);
      return from.handoverBlob
        ? {
            handover: {
              fromCycle: from.cycleId,
              handoverBlob: from.handoverBlob,
            },
          }
        : {};
    }
    case 'restart': {
      const from = requireCycle(state, cause.of);
      return {
        restart: {
          of: from.cycleId,
          reason: `a previous Cycle ended as ${from.outcome ?? from.status}`,
        },
      };
    }
  }
};

/** Questions asked in earlier Cycles of this Station, answered or abandoned (CORE §7). */
const priorQuestionsOf = (
  state: WorkOrderState,
  stationId: StationId,
): CycleContext['priorQuestions'] => {
  const cycleIds = new Set(
    state.cycles
      .filter((cycle) => cycle.stationId === stationId)
      .map((cycle) => cycle.cycleId),
  );
  return state.questions
    .filter((question) => cycleIds.has(question.cycleId))
    .map((question) => ({
      question: question.text,
      ...(question.answer ? { answer: question.answer.text } : {}),
    }));
};

const outputsOf = (station: Station): CycleContext['outputs'] =>
  station.artifacts.map((key) => ({
    key,
    path: `${SCRATCH_DIR}/outputs/${key}`,
  }));

/**
 * What a Cycle of `stationId` starts with, given the cause of its job (CORE §7). Pure: the runtime
 * renders the result into a prompt and stores it as a blob.
 */
export const resolveCycleContext = (
  state: WorkOrderState,
  stationId: StationId,
  cause: CycleCause,
): CycleContext => {
  const station = requireStation(state, stationId);
  const feedback = feedbackFor(state, stationId);
  return {
    inputs: [...orderInputs(state), ...earlierInputs(state, stationId)],
    notes: notesFor(state, stationId),
    ...(feedback ? { feedback } : {}),
    ...causeSections(state, cause),
    nudges: [],
    priorQuestions: priorQuestionsOf(state, stationId),
    outputs: outputsOf(station),
  };
};
