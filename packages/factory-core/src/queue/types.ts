import type { OrderId, ProjectId, CellId } from '../ids';
import type { JobSpec, Next } from '../order/next';
import type { Priority } from '../order/state';
import type { Holder } from '../order/status';

/** CORE §8: one row of the queue projection (STORAGE §4), read with its dependency overlay. */
export interface QueueEntry {
  orderId: OrderId;
  projectId: ProjectId;
  priority: Priority;
  createdAt: number;
  holder: Holder['kind'];
  next: Next['kind'];
  jobKind?: JobSpec['kind'];
  runner?: string; // for Operator stations
  requiredCapabilities: string[]; // the Station's `requires` tags (e.g. 'docker', 'gpu')
  dependsOn: OrderId[];
  deps: 'satisfied' | 'waiting' | 'broken'; // computed when the queue is read, from the other Work orders
  progressed: boolean; // at least one Station passed
  resumed: boolean; // WorkOrderState.resumedWaiting
  lastCellId?: CellId;
  avoidCells: { cellId: CellId; until: number }[]; // cooldown after a workspace failure (never permanent)
}

/** CORE §8: what a Cell offers when it asks for work. */
export interface CellView {
  cellId: CellId;
  projects: ProjectId[];
  runners: string[];
  capabilities: string[];
  freeSlots: number;
}

/** CORE §8: the clock and the per-project concurrency limits a selection runs against. */
export interface Limits {
  now: number;
  perProjectRunning: Record<ProjectId, { max: number; running: number }>;
}
