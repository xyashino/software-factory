import type { ProjectId, WorkerId } from '@repo/factory-core/ids';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import { resolveDeps, type DepPolicy } from '@repo/factory-core/queue/deps';
import type {
  Limits,
  QueueEntry,
  WorkerView,
} from '@repo/factory-core/queue/types';
import type { ProjectRecord } from '@repo/factory-core/ports/projects';
import type { RuntimePorts } from './ports';

/** The queue as `selectClaimable` reads it: every Work order with its dependency state (CORE §8). */
export interface Queue {
  entries: QueueEntry[];
  limits: Limits;
  rows: OrderProjection[];
  projects: Map<ProjectId, ProjectRecord>;
}

const entryOf = (
  row: OrderProjection,
  deps: QueueEntry['deps'],
  now: number,
): QueueEntry => ({
  orderId: row.orderId,
  projectId: row.projectId,
  priority: row.priority,
  createdAt: row.createdAt,
  holder: row.holder,
  next: row.nextKind,
  ...(row.jobKind ? { jobKind: row.jobKind } : {}),
  ...(row.runner ? { runner: row.runner } : {}),
  requiredCapabilities: row.requiredCapabilities,
  dependsOn: row.dependsOn,
  deps,
  progressed: row.progressed,
  resumed: row.resumed,
  ...(row.lastWorkerId ? { lastWorkerId: row.lastWorkerId } : {}),
  avoidWorkers: row.avoidWorkers.filter((avoid) => avoid.until > now),
});

/**
 * Reads the queue. `replace` swaps in the projection a command is about to write, so a continuation
 * sees the Work order as it will stand after the command (STORAGE §3).
 */
export const readQueue = async (
  ports: Pick<RuntimePorts, 'projections' | 'projects' | 'clock'>,
  replace?: OrderProjection,
): Promise<Queue> => {
  const stored = await ports.projections.orders();
  const rows = replace
    ? stored.map((row) => (row.orderId === replace.orderId ? replace : row))
    : stored;
  const projects = new Map(
    (await ports.projects.list()).map((project) => [
      project.projectId,
      project,
    ]),
  );
  const now = ports.clock.now();
  const entries = rows.map((row) => {
    const policy: DepPolicy =
      projects.get(row.projectId)?.depPolicy ?? 'delivered';
    return entryOf(row, resolveDeps(row, rows, policy), now);
  });
  const perProjectRunning: Limits['perProjectRunning'] = {};
  for (const [projectId, project] of projects) {
    perProjectRunning[projectId] = {
      max: project.maxRunning,
      running: rows.filter(
        (row) => row.projectId === projectId && row.holder === 'worker',
      ).length,
    };
  }
  return {
    entries,
    rows,
    projects,
    limits: { now, perProjectRunning },
  };
};

/** The Worker's offer as `selectClaimable` reads it: free slots are its slots less its live leases. */
export const workerView = (
  workerId: WorkerId,
  info: {
    projects: string[];
    runners: string[];
    capabilities: string[];
    slots: number;
  },
  heldLeases: number,
): WorkerView => ({
  workerId,
  projects: info.projects as ProjectId[],
  runners: info.runners,
  capabilities: info.capabilities,
  freeSlots: Math.max(0, info.slots - heldLeases),
});
