import {
  orderIdOf,
  projectIdSchema,
  todoIdSchema,
  workerIdSchema,
  type OrderId,
  type ProjectId,
  type WorkerId,
} from '../../ids';
import type { Limits, QueueEntry, WorkerView } from '../types';

export const NOW = 1_000_000;
export const PROJECT: ProjectId = projectIdSchema.parse('shop');
export const OTHER_PROJECT: ProjectId = projectIdSchema.parse('blog');
export const WORKER: WorkerId = workerIdSchema.parse(
  '01BX5ZZKBKACTAV9WEVGEMMVRY',
);
export const OTHER_WORKER: WorkerId = workerIdSchema.parse(
  '01BX5ZZKBKACTAV9WEVGEMMVRZ',
);

export const orderOf = (
  todo: string,
  projectId: ProjectId = PROJECT,
): OrderId => orderIdOf(projectId, todoIdSchema.parse(todo));

/** A claimable entry: queued, next job, deps satisfied, no requirements, no cooldown. */
export const entry = (overrides: Partial<QueueEntry> = {}): QueueEntry => ({
  orderId: orderOf('task-a'),
  projectId: PROJECT,
  priority: 'medium',
  createdAt: 1_000,
  holder: 'queue',
  next: 'job',
  requiredCapabilities: [],
  dependsOn: [],
  deps: 'satisfied',
  progressed: false,
  resumed: false,
  avoidWorkers: [],
  ...overrides,
});

/** A Worker that serves the shop project, has a free slot and no runner or capability tags. */
export const worker = (overrides: Partial<WorkerView> = {}): WorkerView => ({
  workerId: WORKER,
  projects: [PROJECT],
  runners: [],
  capabilities: [],
  freeSlots: 1,
  ...overrides,
});

/** The shop project has room for two more running Work orders. */
export const limits = (overrides: Partial<Limits> = {}): Limits => ({
  now: NOW,
  perProjectRunning: { [PROJECT]: { max: 2, running: 0 } },
  ...overrides,
});
