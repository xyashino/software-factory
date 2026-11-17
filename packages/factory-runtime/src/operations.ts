import type { CommandResult } from '@repo/factory-core/contracts/cell';
import type {
  ParsedRequest,
  RouteName,
  RouteResponse,
} from '@repo/factory-core/contracts/routes';
import type { CellId, OrderId, PlanId } from '@repo/factory-core/ids';
import { resolveDeps } from '@repo/factory-core/queue/deps';
import { boardStatusWithDeps } from '@repo/factory-core/queue/deps';
import type { PlanProjection } from '@repo/factory-core/plan/projection';
import type { PlanCommand } from '@repo/factory-core/plan/commands';
import { resolveBase } from './job-builder';
import {
  orderCommandSchema,
  type OrderCommand,
} from '@repo/factory-core/order/commands';
import type { Actor } from '@repo/factory-core/order/events';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { RuntimeAdmin } from './admin';
import { assertCell, hello, revokeCell } from './cells';
import { longPollClaim, type ClaimDeps } from './claim';
import type { CommandHandler } from './command-handler';
import { notFound, RuntimeError } from './errors';
import { heartbeat } from './heartbeat';
import { createJoinToken, revokeJoinToken } from './join-tokens';
import type { Revocation } from './revocations';
import {
  addProject,
  ensureProject,
  listProjects,
  removeProject,
  setProject,
} from './projects';
import type { RuntimePorts } from './ports';
import {
  createOrder,
  createPlan,
  recordPlanPrState,
  recordPrState,
} from './task-api';

/** Per-call options a transport passes: the claim long-poll ends when its request ends. */
export interface CallOptions {
  signal?: AbortSignal;
}

export interface Operations {
  call<K extends RouteName>(
    route: K,
    request: ParsedRequest<K>,
    options?: CallOptions,
  ): Promise<RouteResponse<K>>;
}

type Handlers = {
  [K in RouteName]: (
    request: ParsedRequest<K>,
    options: CallOptions,
  ) => Promise<RouteResponse<K>>;
};

const planRow = (plan: PlanProjection) => ({
  planId: plan.planId as PlanId,
  projectId: plan.projectId,
  slug: plan.slug,
  branch: plan.branch,
  baseBranch: plan.baseBranch,
  phase: plan.phase,
  holder: plan.holder,
  nextKind: plan.nextKind,
  jobKind: plan.jobKind,
  memberCount: plan.members.length,
  prUrl: plan.prUrl,
  prState: plan.prState,
  andonReason: plan.andonReason,
  updatedAt: plan.updatedAt,
});

const blockerOf = (
  row: OrderProjection,
  rows: readonly OrderProjection[],
  depPolicy: 'delivered' | 'merged' | undefined,
): string | null => {
  const deps = resolveDeps(row, rows, depPolicy ?? 'delivered');
  const overlay = boardStatusWithDeps(row.status, row.nextKind, deps);
  if (overlay === 'waiting_deps' || overlay === 'deps_broken') return overlay;
  return row.andonReason ? 'andon' : null;
};

const boardRow = (row: OrderProjection) => ({
  orderId: row.orderId,
  projectId: row.projectId,
  todoId: row.todoId,
  title: row.title,
  line: row.line,
  priority: row.priority,
  status: row.status,
  plan: row.plan,
  baseBranch: row.baseBranch,
  dependsOn: row.dependsOn,
  holder: row.holder,
  nextKind: row.nextKind,
  jobKind: row.jobKind,
  runner: row.runner,
  stationId: row.stationId,
  stationIndex: row.stationIndex,
  progressed: row.progressed,
  resumed: row.resumed,
  lastSeq: row.lastSeq,
  andonReason: row.andonReason,
  prUrl: row.prUrl,
  prState: row.prState,
  updatedAt: row.updatedAt,
});

const OPERATOR_COMMANDS = new Set([
  'CompleteCycle',
  'SubmitVerdict',
  'AskQuestion',
  'LeaveNote',
]);

// Commands a Mechanic job sends through its Cell: the incident it records, and the
// Resume or Cancel that follows it. The Cell sends them only for its Mechanic job.
const MECHANIC_COMMANDS = new Set([
  'RecordIncident',
  'Resume',
  'Cancel',
  'Nudge',
]);

/**
 * The actor a Cell's command is run as: the Operator of its Cycle, the Mechanic of its job, or the Cell
 * itself. The plan commands a Cell sends (the reports and `ReleaseJob`) are all the Cell's own;
 * `decidePlan` refuses any other actor.
 */
export const actorOfCellCommand = (
  cellId: CellId,
  command: OrderCommand | PlanCommand,
): Actor => {
  if (OPERATOR_COMMANDS.has(command.type) && 'cycleId' in command) {
    return { kind: 'operator', cellId, cycleId: command.cycleId };
  }
  if (MECHANIC_COMMANDS.has(command.type)) {
    return { kind: 'mechanic', name: 'mechanic' };
  }
  return { kind: 'cell', cellId };
};

const requireResult = (result: CommandResult | undefined): CommandResult => {
  if (!result) throw new Error('a command that may not skip returned nothing');
  return result;
};

/** What the composition root provides beyond the ports: the admin operations. */
export interface OperationExtras {
  admin: RuntimeAdmin;
  /** Told after a revoke committed, so the transports drop what they cached about the credential. */
  revoked(revocation: Revocation): void;
}

/**
 * Every route the runtime serves, in one table. The HTTP listener and the in-process
 * client both call this, so a route behaves the same whichever transport reaches it.
 */
export const createOperations = (
  ports: RuntimePorts,
  handler: CommandHandler,
  claimDeps: ClaimDeps,
  extras: OperationExtras,
): Operations => {
  const supervisorCommand = (
    orderId: OrderId,
    commandId: string,
    raw: Record<string, unknown>,
  ): Promise<CommandResult> => {
    const command: OrderCommand = orderCommandSchema.parse(raw);
    return handler
      .submit({
        orderId,
        commandId,
        command,
        actor: { kind: 'supervisor', name: 'supervisor' },
      })
      .then(requireResult);
  };

  // The board and order reads reap lazily too: an expired lease shows as its reaped state.
  const reaped = async <T>(read: () => Promise<T>): Promise<T> => {
    await claimDeps.reap();
    return read();
  };

  const handlers: Handlers = {
    hello: (request) => hello(ports, request),
    claim: (request, options) =>
      longPollClaim(
        claimDeps,
        request.cellId,
        request.waitMs,
        options.signal,
      ).then((job) => ({ job })),
    heartbeat: (request) => reaped(() => heartbeat(ports, request)),
    submitCommand: async (request) => {
      await assertCell(ports, request.cellId);
      if ('planId' in request) {
        // A plan job's report: the Cell's epoch fences it on the plan stream, nothing is routed further.
        const result = await handler.submitPlan({
          planId: request.planId,
          commandId: request.commandId,
          command: request.command,
          actor: actorOfCellCommand(request.cellId, request.command),
          epoch: request.epoch,
          ...(request.dryRun !== undefined ? { dryRun: request.dryRun } : {}),
        });
        return {
          dryRun: result.dryRun,
          events: result.events,
          next: null,
        };
      }
      const command = orderCommandSchema.parse(request.command);
      return requireResult(
        await handler.submit({
          orderId: request.orderId,
          commandId: request.commandId,
          command,
          actor: actorOfCellCommand(request.cellId, command),
          epoch: request.epoch,
          ...(request.dryRun !== undefined ? { dryRun: request.dryRun } : {}),
          continueFor: request.cellId,
        }),
      );
    },
    blobPut: async (request) => {
      ports.writer.assertHeld();
      const bytes = new Uint8Array(Buffer.from(request.base64, 'base64'));
      try {
        await ports.blobs.put(
          request.ref,
          bytes,
          request.mediaType ?? 'application/octet-stream',
        );
      } catch (error) {
        throw new RuntimeError({
          code: 'invalid',
          issues: [error instanceof Error ? error.message : String(error)],
        });
      }
      return { ref: request.ref };
    },
    blobGet: async (request) => {
      const bytes = await ports.blobs.get(request.ref);
      if (!bytes) throw notFound();
      return {
        ref: request.ref,
        base64: Buffer.from(bytes).toString('base64'),
      };
    },
    board: () =>
      reaped(async () => ({
        orders: (await ports.projections.orders()).map(boardRow),
      })),
    plans: () =>
      reaped(async () => ({
        plans: (await ports.projections.plans()).map(planRow),
      })),
    planDetail: (request) =>
      reaped(async () => {
        const plans = await ports.projections.plans();
        const plan = plans.find(
          (candidate) => candidate.planId === request.planId,
        );
        if (!plan) throw notFound();
        const rows = await ports.projections.orders();
        const policies = new Map(
          (await ports.projects.list()).map((project) => [
            project.projectId,
            project.depPolicy,
          ]),
        );
        return {
          plan: planRow(plan),
          members: plan.members.map((member) => {
            const row = rows.find(
              (candidate) => candidate.orderId === member.orderId,
            );
            return {
              orderId: member.orderId,
              todoId: member.todoId,
              after: member.after ?? null,
              state: member.state,
              status: row?.status ?? null,
              baseBranch: row
                ? resolveBase(
                    {
                      plan: row.plan ?? undefined,
                      dependsOn: row.dependsOn,
                      baseBranch: row.baseBranch,
                    },
                    rows,
                  )
                : null,
              prUrl: row?.prUrl ?? null,
              blocker: row
                ? blockerOf(row, rows, policies.get(row.projectId))
                : null,
            };
          }),
        };
      }),
    orderDetail: (request) =>
      reaped(async () => {
        const events = await ports.events.load(request.orderId);
        const row = (await ports.projections.orders()).find(
          (candidate) => candidate.orderId === request.orderId,
        );
        if (events.length === 0 || !row) throw notFound();
        return { order: boardRow(row), events };
      }),
    createOrder: (request) => createOrder(ports, handler, request),
    createPlan: (request) => createPlan(ports, handler, request),
    recordPrState: (request) => recordPrState(handler, request),
    recordPlanPrState: (request) => recordPlanPrState(handler, request),
    answer: (request) =>
      supervisorCommand(request.orderId, request.commandId, {
        type: 'Answer',
        questionId: request.questionId,
        text: request.text,
      }),
    nudge: (request) =>
      supervisorCommand(request.orderId, request.commandId, {
        type: 'Nudge',
        text: request.text,
      }),
    cancel: (request) =>
      supervisorCommand(request.orderId, request.commandId, {
        type: 'Cancel',
        reason: request.reason,
      }),
    reprioritise: (request) =>
      supervisorCommand(request.orderId, request.commandId, {
        type: 'Reprioritise',
        priority: request.priority,
      }),
    resume: (request) =>
      supervisorCommand(request.orderId, request.commandId, {
        type: 'Resume',
        mode: request.mode,
        ...(request.noteBlob !== undefined
          ? { noteBlob: request.noteBlob }
          : {}),
        ...(request.grantRetries !== undefined
          ? { grantRetries: request.grantRetries }
          : {}),
      }),
    reopen: (request) =>
      supervisorCommand(request.orderId, request.commandId, {
        type: 'Reopen',
        stationId: request.stationId,
        ...(request.noteBlob !== undefined
          ? { noteBlob: request.noteBlob }
          : {}),
      }),
    cellsList: async () => ({
      cells: (await ports.cells.list()).map((cell) => ({
        cellId: cell.cellId,
        name: cell.name,
        lastSeenAt: cell.lastSeenAt,
        revokedAt: cell.revokedAt,
      })),
    }),
    cellRevoke: async (request) => {
      await revokeCell(ports, request.cellId);
      extras.revoked({ kind: 'cell', cellId: request.cellId });
      return { cellId: request.cellId, revoked: true as const };
    },
    supervisorEvents: async (request, options) => {
      // Held like a claim: answers at once when newer events exist, else waits for a commit.
      const waitMs = request.waitMs ?? 0;
      const deadline = ports.clock.now() + waitMs;
      for (;;) {
        const events = await ports.events.feed(request.afterGlobalSeq, 500);
        const last = events[events.length - 1];
        if (last) return { events, nextSeq: last.globalSeq };
        const remaining = deadline - ports.clock.now();
        if (remaining <= 0 || options.signal?.aborted) {
          return { events: [], nextSeq: request.afterGlobalSeq };
        }
        await claimDeps.notifier.waitFor(
          Math.min(remaining, ports.config.claimTickMs),
          options.signal,
        );
      }
    },
    joinTokenCreate: (request) => createJoinToken(ports, request),
    joinTokenList: async () => ({
      tokens: (await ports.joinTokens.list()).map((token) => ({
        joinTokenId: token.joinTokenId,
        name: token.name,
        createdAt: token.createdAt,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt,
      })),
    }),
    joinTokenRevoke: async (request) => {
      await revokeJoinToken(ports, request.joinTokenId);
      extras.revoked({ kind: 'joinToken', joinTokenId: request.joinTokenId });
      return { joinTokenId: request.joinTokenId, revoked: true as const };
    },
    projectList: () => listProjects(ports),
    projectAdd: (request) => addProject(ports, request),
    cellProjectEnsure: (request) => ensureProject(ports, request),
    projectSet: (request) => {
      const { projectId, ...patch } = request;
      return setProject(ports, projectId, patch);
    },
    projectRemove: (request) => removeProject(ports, request.projectId),
    adminExport: async () => {
      const bytes = await ports.exportArchive();
      return {
        base64: Buffer.from(bytes).toString('base64'),
        bytes: bytes.byteLength,
      };
    },
    adminBackup: async (request) => ({
      file: request.file,
      counts: await extras.admin.backup(request.file),
    }),
    adminRebuildProjections: async () => ({
      rows: await extras.admin.rebuildProjections(),
    }),
  };

  return {
    call: <K extends RouteName>(
      route: K,
      request: ParsedRequest<K>,
      options: CallOptions = {},
    ): Promise<RouteResponse<K>> => {
      const handlerFn = handlers[route] as (
        request: ParsedRequest<K>,
        options: CallOptions,
      ) => Promise<RouteResponse<K>>;
      return handlerFn(request, options);
    },
  };
};
