import {
  planIdOf,
  type CellId,
  type PlanId,
  type ProjectId,
} from '@repo/factory-core/ids';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import {
  indexDeps,
  resolveDeps,
  type DepPolicy,
} from '@repo/factory-core/queue/deps';
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
 * What one queue pass reads from the projections and the project registry. A caller that needs the
 * queue more than once in a command loads it once (`loadQueueSnapshot`) and derives each queue from it.
 */
export interface QueueSnapshot {
  rows: OrderProjection[];
  plans: PlanProjection[];
  projects: ProjectRecord[];
}

/** Reads the three projections a queue is built from, once each. */
export const loadQueueSnapshot = async (
  ports: Pick<RuntimePorts, 'projections' | 'projects'>,
): Promise<QueueSnapshot> => ({
  rows: await ports.projections.orders(),
  plans: await ports.projections.plans(),
  projects: await ports.projects.list(),
});

/**
 * Builds the queue from a snapshot, in O(N). `replace` swaps in the projection a command is about to
 * write, so a continuation sees the Work order as it will stand after the command (STORAGE §3).
 */
export const queueOf = (
  snapshot: QueueSnapshot,
  now: number,
  replace?: OrderProjection,
): Queue => {
  const rows = replace
    ? snapshot.rows.map((row) =>
        row.orderId === replace.orderId ? replace : row,
      )
    : snapshot.rows;
  const plansById = new Map<PlanId, PlanProjection>(
    snapshot.plans.map((plan) => [plan.planId, plan]),
  );
  const projects = new Map(
    snapshot.projects.map((project) => [project.projectId, project]),
  );
  // One index of the pass: each dependency is then an O(1) lookup, not a rebuild per Work order.
  const byId = indexDeps(rows);
  const entries = rows.map((row) => {
    const policy: DepPolicy =
      projects.get(row.projectId)?.depPolicy ?? 'delivered';
    const deps = resolveDeps(row, byId, policy);
    return entryOf(row, rootGated(row, plansById) ? 'waiting' : deps, now);
  });
  const running = new Map<ProjectId, number>();
  for (const row of rows) {
    if (row.holder === 'cell') {
      running.set(row.projectId, (running.get(row.projectId) ?? 0) + 1);
    }
  }
  const perProjectRunning: Limits['perProjectRunning'] = {};
  for (const [projectId, project] of projects) {
    perProjectRunning[projectId] = {
      max: project.maxRunning,
      running: running.get(projectId) ?? 0,
    };
  }
  return {
    entries,
    rows,
    projects,
    limits: { now, perProjectRunning },
  };
};

/** Reads the queue. `replace` swaps in the projection a command is about to write (see `queueOf`). */
export const readQueue = async (
  ports: Pick<RuntimePorts, 'projections' | 'projects' | 'clock'>,
  replace?: OrderProjection,
): Promise<Queue> =>
  queueOf(await loadQueueSnapshot(ports), ports.clock.now(), replace);

/** The Cell's offer as `selectClaimable` reads it: a Cell is busy while it holds any live lease. */
export const cellView = (
  cellId: CellId,
  info: {
    projects: string[];
    runners: string[];
    capabilities: string[];
  },
  heldLeases: number,
): CellView => ({
  cellId,
  projects: info.projects as ProjectId[],
  runners: info.runners,
  capabilities: info.capabilities,
  busy: heldLeases > 0,
});
