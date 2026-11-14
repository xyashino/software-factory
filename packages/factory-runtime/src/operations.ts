import type { CommandResult } from '@repo/factory-core/contracts/cell';
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
import type { OrderId, CellId } from '@repo/factory-core/ids';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { CommandHandler } from './command-handler';
import { RuntimeError, notFound } from './errors';
import { heartbeat } from './heartbeat';
import { hello, assertCell, revokeCell } from './cells';
import { createJoinToken, revokeJoinToken } from './join-tokens';
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
 * Commands an Operator sends through its Cell (PROTOCOL §3.3). The Cell forwards them with the
 * Operator's actor and Cycle, so `decide` sees the actor the command requires (CORE §5.2).
 */
const OPERATOR_COMMANDS = new Set([
  'CompleteCycle',
  'SubmitVerdict',
  'AskQuestion',
  'LeaveNote',
]);

/** The actor a Cell's command is run as: the Operator of its Cycle, or the Cell itself. */
export const actorOfCellCommand = (
  cellId: CellId,
  command: OrderCommand,
): Actor => {
  if (OPERATOR_COMMANDS.has(command.type) && 'cycleId' in command) {
    return { kind: 'operator', cellId, cycleId: command.cycleId };
  }
  return { kind: 'cell', cellId };
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
        request.cellId,
        request.waitMs,
        options.signal,
      ).then((job) => ({ job })),
    heartbeat: (request) => heartbeat(ports, request),
    submitCommand: async (request) => {
      await assertCell(ports, request.cellId);
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
    intakeSync: async () => {
      if (!ports.intake) {
        throw new RuntimeError({
          code: 'precondition',
          detail: 'intake is not built yet (v2-10): nothing was synced',
        });
      }
      return ports.intake.sync();
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
      return { joinTokenId: request.joinTokenId, revoked: true as const };
    },
    adminExport: async () => {
      const bytes = await ports.exportArchive();
      return {
        base64: Buffer.from(bytes).toString('base64'),
        bytes: bytes.byteLength,
      };
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
