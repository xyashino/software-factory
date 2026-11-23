import type {
  CellId,
  FactoryId,
  JobId,
  OrderId,
  ProjectId,
} from '../common/brand';
import type { Priority, WorkOrderState } from '../orders/order-state';

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export type ClaimCell = {
  cellId: CellId;
  factoryId: FactoryId;
  projectId: ProjectId;
  allowedLines: string[];
};

export type ClaimCandidate = {
  orderId: OrderId;
  projectId: ProjectId;
  state: WorkOrderState;
  priority: Priority;
  lineName: string;
  createdAt: number;
  pinnedFactoryId: FactoryId | null;
  pinnedFactoryUnavailable: boolean;
  activeCellId: CellId | null;
  activeJobId: JobId | null;
  unavailableLineFactories: FactoryId[];
};

export type ClaimContext = {
  runningCount: number;
  maxRunning: number;
};

export const allowsLine = (
  allowedLines: readonly string[],
  lineName: string,
): boolean => allowedLines.includes('*') || allowedLines.includes(lineName);

const isPinnable = (candidate: ClaimCandidate, factoryId: FactoryId): boolean =>
  candidate.pinnedFactoryId === null ||
  candidate.pinnedFactoryId === factoryId ||
  candidate.pinnedFactoryUnavailable;

const isWarm = (candidate: ClaimCandidate, cell: ClaimCell): boolean =>
  candidate.pinnedFactoryId === cell.factoryId;

const byClaimOrder =
  (cell: ClaimCell) =>
  (a: ClaimCandidate, b: ClaimCandidate): number => {
    const warmDelta = Number(isWarm(b, cell)) - Number(isWarm(a, cell));
    if (warmDelta !== 0) return warmDelta;
    const priorityDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return a.createdAt - b.createdAt;
  };

export const isEligible = (
  candidate: ClaimCandidate,
  cell: ClaimCell,
  context: ClaimContext,
): boolean =>
  candidate.state === 'queued' &&
  candidate.activeCellId === null &&
  candidate.activeJobId === null &&
  candidate.projectId === cell.projectId &&
  allowsLine(cell.allowedLines, candidate.lineName) &&
  !candidate.unavailableLineFactories.includes(cell.factoryId) &&
  isPinnable(candidate, cell.factoryId) &&
  context.runningCount < context.maxRunning;

export const selectClaimable = (
  candidates: ClaimCandidate[],
  cell: ClaimCell,
  context: ClaimContext,
): ClaimCandidate[] =>
  candidates
    .filter((candidate) => isEligible(candidate, cell, context))
    .sort(byClaimOrder(cell));
