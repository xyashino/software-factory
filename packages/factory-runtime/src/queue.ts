import {
  planIdOf,
  type CellId,
  type PlanId,
  type ProjectId,
} from '@repo/factory-core/ids';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import { resolveDeps, type DepPolicy } from '@repo/factory-core/queue/deps';
import type {
  Limits,
  QueueEntry,
  CellView,
} from '@repo/factory-core/queue/types';
import type { ProjectRecord } from '@repo/factory-core/ports/projects';
import type { RuntimePorts } from './ports';

/**
 * CORE §12.6: the root of a plan waits until the plan has its branch (`phase` not `branching`). A
 * member whose plan has no row yet waits too: intake creates the plan before its members, so this is a race.
 */
const rootGated = (
  row: OrderProjection,
  plansById: ReadonlyMap<PlanId, PlanProjection>,
): boolean => {
  if (row.plan === null) return false;
  const plan = plansById.get(planIdOf(row.projectId, row.plan));
  if (!plan) return true;
  const isRoot = plan.members[0]?.orderId === row.orderId;
  return isRoot && plan.phase === 'branching';
};

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
  ...(row.lastCellId ? { lastCellId: row.lastCellId } : {}),
  avoidCells: row.avoidCells.filter((avoid) => avoid.until > now),
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
  const plansById = new Map<PlanId, PlanProjection>(
    (await ports.projections.plans()).map((plan) => [plan.planId, plan]),
  );
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
    const deps = resolveDeps(row, rows, policy);
    return entryOf(row, rootGated(row, plansById) ? 'waiting' : deps, now);
  });
  const perProjectRunning: Limits['perProjectRunning'] = {};
  for (const [projectId, project] of projects) {
    perProjectRunning[projectId] = {
      max: project.maxRunning,
      running: rows.filter(
        (row) => row.projectId === projectId && row.holder === 'cell',
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

/** The Cell's offer as `selectClaimable` reads it: free slots are its slots less its live leases. */
export const cellView = (
  cellId: CellId,
  info: {
    projects: string[];
    runners: string[];
    capabilities: string[];
    slots: number;
  },
  heldLeases: number,
): CellView => ({
  cellId,
  projects: info.projects as ProjectId[],
  runners: info.runners,
  capabilities: info.capabilities,
  freeSlots: Math.max(0, info.slots - heldLeases),
});
