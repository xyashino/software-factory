import type { CommandOf } from '@repo/factory-core/order/commands';
import type {
  CommitSha,
  OrderId,
  ProjectId,
  StationId,
  TodoId,
} from '@repo/factory-core/ids';
import type { Station } from '@repo/factory-core/line/snapshot';
import type { BranchLog } from '@repo/factory-core/ports/git-mirror';
import type { ProjectRecord } from '@repo/factory-core/ports/projects';
import type { CommandHandler } from './command-handler';
import type { RuntimePorts } from './ports';
import { syncProject } from './intake';
import { foldHistory } from './state';

/** The branch a Work order's progress lives on (STORAGE §8, PROTOCOL §8.1). */
const BRANCH_PREFIX = 'factory/';

/** What the branch scan found: the newest commit that says a Station passed. */
export interface Checkpoint {
  commit: CommitSha;
  passedStations: StationId[];
  afterStation: StationId;
}

export interface RecoveredOrder {
  orderId: OrderId;
  todoId: TodoId;
  passedStations: StationId[];
  checkpoint: CommitSha;
  delivered: boolean;
}

export interface SkippedOrder {
  orderId: OrderId;
  todoId: TodoId;
  reason: string;
}

export interface RecoveryReport {
  recovered: RecoveredOrder[];
  skipped: SkippedOrder[];
}

/** The trailers of a commit message: the `Factory-*` lines (PROTOCOL §8.2). */
export const trailersOf = (message: string): Record<string, string> => {
  const trailers: Record<string, string> = {};
  for (const line of message.split('\n')) {
    const match = /^(Factory-[A-Za-z]+): (.+)$/.exec(line.trimEnd());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      trailers[match[1]] = match[2];
    }
  }
  return trailers;
};

/**
 * The newest commit of a branch whose trailers say a Station passed (`Factory-Outcome: passed`,
 * with `Factory-Order` and `Factory-Station`). A commit that names a Station the Line does not have
 * is not a usable checkpoint, so the scan goes on to older commits. Undefined when none qualifies.
 */
export const checkpointOf = (
  log: BranchLog,
  stations: readonly Station[],
): Checkpoint | undefined => {
  const order = stations.map((station) => station.id);
  for (const commit of log.commits) {
    const trailers = trailersOf(commit.message);
    if (trailers['Factory-Outcome'] !== 'passed') continue;
    if (!trailers['Factory-Order'] || !trailers['Factory-Station']) continue;
    const index = order.indexOf(trailers['Factory-Station'] as StationId);
    if (index === -1) continue;
    return {
      commit: commit.sha,
      passedStations: order.slice(0, index + 1),
      afterStation: order[index]!,
    };
  }
  return undefined;
};

/** Runs intake for one project, then recovers every fresh Work order of it from its branch. */
const recoverProject = async (
  ports: RuntimePorts,
  handler: CommandHandler,
  project: ProjectRecord,
  report: RecoveryReport,
): Promise<void> => {
  await syncProject(ports, handler, project);
  const logs = await ports.git.branches(project.projectId, BRANCH_PREFIX);
  const logOf = new Map(logs.map((log) => [log.branch, log]));
  for (const row of await ports.projections.orders()) {
    if (row.projectId !== project.projectId) continue;
    const state = foldHistory(await ports.events.load(row.orderId));
    if (!state) continue;
    const base = { orderId: row.orderId, todoId: row.todoId };
    // A Work order that ever claimed a job, or was recovered already, keeps its own history.
    if (
      state.epoch > 0 ||
      state.cycles.length > 0 ||
      state.recovered.length > 0
    ) {
      report.skipped.push({ ...base, reason: 'already has progress' });
      continue;
    }
    if (state.phase.kind === 'cancelled') {
      report.skipped.push({ ...base, reason: 'cancelled' });
      continue;
    }
    const branch = `${BRANCH_PREFIX}${row.todoId}`;
    const log = logOf.get(branch);
    const pr = await ports.prState.forBranch(project.repoUrl, branch);
    const found = log ? checkpointOf(log, state.line.stations) : undefined;
    // Only an open or merged PR delivers the order (STORAGE §8); a closed, unmerged one is ignored.
    const delivering = pr !== undefined && pr.state !== 'closed';

    if (delivering && log !== undefined) {
      // The PR was opened from the branch tip: every Station passed, and the Work order is delivered.
      const tip = log.commits[0]?.sha;
      if (tip === undefined) {
        report.skipped.push({ ...base, reason: `${branch} has no commits` });
        continue;
      }
      const all = state.line.stations.map((station) => station.id);
      const last = all.at(-1);
      if (last === undefined) {
        report.skipped.push({ ...base, reason: 'the Line has no Stations' });
        continue;
      }
      await submitRecovery(
        handler,
        row.orderId,
        row.todoId,
        {
          passedStations: all,
          checkpoint: { commit: tip, afterStation: last },
          delivery: { prUrl: pr.prUrl, commit: tip, state: pr.state },
        },
        report,
        true,
      );
      continue;
    }
    if (found === undefined) {
      report.skipped.push({
        ...base,
        reason: `no commit with Factory-Outcome: passed on ${branch}`,
      });
      continue;
    }
    await submitRecovery(
      handler,
      row.orderId,
      row.todoId,
      {
        passedStations: found.passedStations,
        checkpoint: { commit: found.commit, afterStation: found.afterStation },
      },
      report,
      false,
    );
  }
};

/** Submits `RecoverOrder` under the deterministic command id of the checkpoint (idempotent). */
const submitRecovery = async (
  handler: CommandHandler,
  orderId: OrderId,
  todoId: TodoId,
  command: Omit<CommandOf<'RecoverOrder'>, 'type'>,
  report: RecoveryReport,
  delivered: boolean,
): Promise<void> => {
  await handler.submit({
    orderId,
    commandId: `recover:${orderId}:${command.checkpoint.commit}`,
    command: { type: 'RecoverOrder', ...command },
    actor: { kind: 'factory' },
  });
  report.recovered.push({
    orderId,
    todoId,
    passedStations: [...command.passedStations],
    checkpoint: command.checkpoint.commit,
    delivered,
  });
};

/**
 * Rebuilds the Work orders of the registered projects from git, after their database is gone (STORAGE
 * §8). Intake runs first, so every todo at the base branch has an order; then each fresh order takes
 * its checkpoint from `factory/<todoId>` and an existing PR marks it delivered. Idempotent: a Work
 * order with progress, or one recovered already, is skipped, and a replay of a command appends nothing.
 * The caller holds the writer lock.
 */
export const recoverFromGit = async (
  ports: RuntimePorts,
  handler: CommandHandler,
  projectId?: ProjectId,
): Promise<RecoveryReport> => {
  const report: RecoveryReport = { recovered: [], skipped: [] };
  for (const project of await ports.projects.list()) {
    if (projectId !== undefined && project.projectId !== projectId) continue;
    await recoverProject(ports, handler, project, report);
  }
  return report;
};
