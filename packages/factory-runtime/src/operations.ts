import type { CommandResult } from '@repo/factory-core/contracts/worker';
import type {
  ParsedRequest,
  RouteName,
  RouteResponse,
} from '@repo/factory-core/contracts/routes';
import {
  orderCommandSchema,
  type OrderCommand,
} from '@repo/factory-core/order/commands';
import type { Actor } from '@repo/factory-core/order/events';
import type { OrderId, WorkerId } from '@repo/factory-core/ids';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { CommandHandler } from './command-handler';
import { RuntimeError, notFound } from './errors';
import { heartbeat } from './heartbeat';
import { hello, assertWorker, revokeWorker } from './workers';
import { longPollClaim, type ClaimDeps } from './claim';
import type { RuntimePorts } from './ports';

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

const boardRow = (row: OrderProjection) => ({
  orderId: row.orderId,
  projectId: row.projectId,
  todoId: row.todoId,
  title: row.title,
  line: row.line,
  priority: row.priority,
  status: row.status,
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

/**
 * Commands an Operator sends through its Worker (PROTOCOL §3.3). The Worker forwards them with the
 * Operator's actor and Cycle, so `decide` sees the actor the command requires (CORE §5.2).
 */
const OPERATOR_COMMANDS = new Set([
  'CompleteCycle',
  'SubmitVerdict',
  'AskQuestion',
  'LeaveNote',
]);

/** The actor a Worker's command is run as: the Operator of its Cycle, or the Worker itself. */
export const actorOfWorkerCommand = (
  workerId: WorkerId,
  command: OrderCommand,
): Actor => {
  if (OPERATOR_COMMANDS.has(command.type) && 'cycleId' in command) {
    return { kind: 'operator', workerId, cycleId: command.cycleId };
  }
  return { kind: 'worker', workerId };
};

const requireResult = (result: CommandResult | undefined): CommandResult => {
  if (!result) throw new Error('a command that may not skip returned nothing');
  return result;
};

/**
 * Every route the runtime serves, in one table (PROTOCOL §3). The socket server and the in-process
 * client both call this, so a route behaves the same whichever transport reaches it.
 */
export const createOperations = (
  ports: RuntimePorts,
  handler: CommandHandler,
  claimDeps: ClaimDeps,
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

  const handlers: Handlers = {
    hello: (request) => hello(ports, request),
    claim: (request, options) =>
      longPollClaim(
        claimDeps,
        request.workerId,
        request.waitMs,
        options.signal,
      ).then((job) => ({ job })),
    heartbeat: (request) => heartbeat(ports, request),
    submitCommand: async (request) => {
      await assertWorker(ports, request.workerId);
      const command = orderCommandSchema.parse(request.command);
      return requireResult(
        await handler.submit({
          orderId: request.orderId,
          commandId: request.commandId,
          command,
          actor: actorOfWorkerCommand(request.workerId, command),
          epoch: request.epoch,
          ...(request.dryRun !== undefined ? { dryRun: request.dryRun } : {}),
          continueFor: request.workerId,
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
    board: async () => ({
      orders: (await ports.projections.orders()).map(boardRow),
    }),
    orderDetail: async (request) => {
      const events = await ports.events.load(request.orderId);
      const row = (await ports.projections.orders()).find(
        (candidate) => candidate.orderId === request.orderId,
      );
      if (events.length === 0 || !row) throw notFound();
      return { order: boardRow(row), events };
    },
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
    workersList: async () => ({
      workers: (await ports.workers.list()).map((worker) => ({
        workerId: worker.workerId,
        name: worker.name,
        lastSeenAt: worker.lastSeenAt,
        revokedAt: worker.revokedAt,
      })),
    }),
    workerRevoke: async (request) => {
      await revokeWorker(ports, request.workerId);
      return { workerId: request.workerId, revoked: true as const };
    },
  };

  return {
    call: <K extends RouteName>(
      route: K,
      request: ParsedRequest<K>,
      options: CallOptions = {},
    ): Promise<RouteResponse<K>> => {
      const handler = handlers[route] as (
        request: ParsedRequest<K>,
        options: CallOptions,
      ) => Promise<RouteResponse<K>>;
      return handler(request, options);
    },
  };
};
