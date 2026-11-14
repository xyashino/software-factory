import type { LineSnapshot } from '../line/snapshot';
import type {
  BlobRef,
  CellId,
  CommitSha,
  CycleId,
  JobId,
  OrderId,
  ProjectId,
  QuestionId,
  ResumeId,
  StationId,
  TodoId,
} from '../ids';
import type {
  AndonReason,
  CycleCause,
  InspectionResult,
  JobKind,
  Spec,
} from './events';

export type Priority = 'high' | 'medium' | 'low';

export type Phase =
  | { kind: 'stations'; index: number } // index into line.stations of the Station to run next
  | { kind: 'delivering' } // all Stations passed
  | { kind: 'delivered' } // a PR exists
  | { kind: 'cancelled'; reason: string };

export type CycleStatus =
  'running' | 'passed' | 'failed' | 'blocked' | 'handed_over';

export type CycleOutcome =
  | 'done'
  | 'verdict_pass'
  | 'verdict_fail'
  | 'inspection_pass'
  | 'inspection_fail'
  | 'timed_out'
  | 'crashed'
  | 'stalled'
  | 'start_failed'
  | 'lost'
  | 'blocked'
  | 'handed_over';

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface CycleState {
  cycleId: CycleId;
  jobId: JobId;
  cellId: CellId;
  stationId: StationId;
  n: number; // per Station, 1-based
  cause: CycleCause;
  status: CycleStatus;
  outcome?: CycleOutcome;
  startedAt: number;
  endedAt?: number;
  baseCommit: CommitSha;
  commit?: CommitSha;
  artifacts: Record<string, BlobRef>;
  feedbackBlob?: BlobRef;
  inspectionResults: InspectionResult[];
  handoverBlob?: BlobRef;
  pausedMs: number; // time spent on answered questions; excluded from timeouts
  pausedSince?: number;
  usage?: Usage;
}

export interface StationNote {
  cycleId: CycleId;
  fromStation: StationId;
  to: StationId | 'supervisor';
  text: string;
}

export interface QuestionRecord {
  questionId: QuestionId;
  cycleId: CycleId;
  text: string;
  status: 'open' | 'answered' | 'abandoned';
  askedAt: number;
  answer?: { by: string; text: string; at: number };
}

export interface ActiveJob {
  jobId: JobId;
  kind: JobKind;
  cellId: CellId;
  epoch: number;
  cycleId?: CycleId;
}

export interface WorkOrderState {
  orderId: OrderId;
  projectId: ProjectId;
  todoId: TodoId;
  spec: Spec;
  priority: Priority;
  dependsOn: OrderId[];
  line: LineSnapshot; // pinned, never re-read from disk

  phase: Phase;
  cycles: CycleState[]; // start order
  lastPassed: Partial<Record<StationId, CycleId>>; // a Station absent here has not passed (or was rewound)
  retriesUsed: Record<StationId, number>; // lifetime, per failing Station; never reset
  retryGrants: Record<StationId, number>; // extra budget granted by `resumed`
  restartsUsed: Record<StationId, number>; // `restart` Cycles since that Station last passed
  lostRestartsUsed: Record<StationId, number>; // `lost` restarts and handovers since that Station last passed
  pendingFeedback?: { forStation: StationId; fromCycle: CycleId } | undefined;
  pendingResume?:
    | {
        resumeId: ResumeId;
        forStation: StationId;
        fromCycle?: CycleId; // absent: start fresh at that Station on the checkpoint
        noteBlob?: BlobRef;
      }
    | undefined;
  checkpoint?:
    { commit: CommitSha; afterStation: StationId | null } | undefined;
  notes: StationNote[];
  questions: QuestionRecord[]; // full history; at most one with status 'open'
  andon?: { reason: AndonReason; detail: string; at: number } | undefined;
  activeJob?: ActiveJob | undefined;
  epoch: number; // the last issued epoch, 0 before any claim
  workspaceFailures: { cellId: CellId; jobId: JobId; at: number }[]; // consecutive; see CORE §4.3 rule 10
  deliveryFailed?: { jobId: JobId; detail: string } | undefined;
  delivery?:
    | { prUrl: string; commit: CommitSha; state: 'open' | 'merged' | 'closed' }
    | undefined;
  resumedWaiting: boolean; // a `resumed` / `reopened` has not yet led to a claimed job
}
