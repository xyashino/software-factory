import type { OrderId, ProjectId, CellId } from '../ids';
import type { JobSpec, Next } from '../order/next';
import type { Priority } from '../order/state';
import type { Holder } from '../order/status';

/** One row of the queue projection, read with its dependency overlay. */
export interface QueueEntry {
  orderId: OrderId;
  projectId: ProjectId;
  priority: Priority;
  createdAt: number;
  holder: Holder['kind'];
  next: Next['kind'];
  jobKind?: JobSpec['kind'];
  runner?: string; // for Operator stations
  dependsOn: OrderId[];
  deps: 'satisfied' | 'waiting' | 'broken'; // computed when the queue is read, from the other Work orders
  progressed: boolean; // at least one Station passed
  resumed: boolean; // WorkOrderState.resumedWaiting
  lastCellId?: CellId;
  avoidCells: { cellId: CellId; until: number }[]; // cooldown after a workspace failure (never permanent)
}

/** What a Cell offers when it asks for work. */
export interface CellView {
  cellId: CellId;
  projects: ProjectId[];
  runners: string[];
  capabilities: string[];
  /** True while the Cell holds a live lease: it runs one Work order at a time. */
  busy: boolean;
}

/** The clock and the per-project concurrency limits a selection runs against. */
export interface Limits {
  now: number;
  perProjectRunning: Record<ProjectId, { max: number; running: number }>;
}
