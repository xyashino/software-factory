import { invalidWire } from '@repo/factory-core/contracts/errors';
import {
  joinRequestSchema,
  joinResponseSchema,
} from '@repo/factory-core/contracts/cell';
import { ROUTES } from '@repo/factory-core/contracts/routes';
import { isPlanId, type CellId, type JobId } from '@repo/factory-core/ids';
import { isRuntimeError } from '@repo/factory-runtime/errors';
import { RefusalError } from '../core/error-handling';
import {
  callRoute,
  cellProcedure,
  publicProcedure,
  replyOf,
  routeInput,
  supervisorProcedure,
  type Call,
  type Handler,
  type Procedure,
} from '../core/procedure';
import { withZodSchema } from '../core/schema/zod';

/** The Cell a bearer-authed call came from: its credential, never the body, names it (PROTOCOL §1). */
const cellOf = (call: Call): CellId => {
  if (call.caller?.kind !== 'cell') {
    throw new RefusalError({ code: 'unauthorized' });
  }
  return call.caller.cellId;
};

/** The body of a Cell call with its `cellId` set to the credential's Cell; a body naming another refuses. */
const cellInput = (call: Call): Record<string, unknown> => {
  const cellId = cellOf(call);
  const input: Record<string, unknown> = { ...routeInput(call) };
  if (input.cellId !== undefined && input.cellId !== cellId) {
    throw new RefusalError(
      invalidWire([
        { path: ['cellId'], message: 'does not match the credential' },
      ]),
    );
  }
  input.cellId = cellId;
  return input;
};

const cellRoute =
  (route: 'hello' | 'heartbeat'): Handler =>
  async (call, transport) =>
    replyOf(
      route,
      await callRoute(route, cellInput(call), transport, call.signal),
    );

/** `claim`: a job answers 200, no job answers 204 with an empty body (PROTOCOL §4). */
const claim: Handler = async (call, transport) => {
  const reply = ROUTES.claim.response.parse(
    await callRoute('claim', cellInput(call), transport, call.signal),
  );
  return reply.job === null ? { kind: 'empty' } : { kind: 'json', body: reply };
};

/**
 * `submitCommand`: the Cell's lease names the Work order (or Order Plan) of its job, and the body
 * carries it. A job whose lease is gone keeps the order the body names: the runtime's epoch guard then
 * refuses the command with stale_epoch (PROTOCOL §11).
 */
const submitCommand: Handler = async (call, transport) => {
  const cellId = cellOf(call);
  const input = cellInput(call);
  const jobId = call.params.jobId as JobId;
  delete input.jobId;
  const held = await transport.runtime.remote
    .orderOfJob(cellId, jobId)
    .catch((error: unknown) => {
      if (isRuntimeError(error) && error.wire.code === 'not_found') {
        return undefined;
      }
      throw error;
    });
  // A plan job's lease names its plan, so the body carries `planId` for that variant (PROTOCOL §4).
  if (held !== undefined) {
    if (isPlanId(held)) input.planId = held;
    else input.orderId = held;
  }
  return replyOf(
    'submitCommand',
    await callRoute('submitCommand', input, transport, call.signal),
  );
};

/** `join`: the join token in the body admits a new Cell (PROTOCOL §1). No bearer token is read. */
const join: Handler = async (call, transport) => {
  const value = call.body.kind === 'json' ? call.body.value : undefined;
  const joined = await transport.runtime.remote.joinCell(
    withZodSchema(joinRequestSchema)(value),
  );
  return { kind: 'json', body: joinResponseSchema.parse(joined) };
};

export const cellProcedures: readonly Procedure[] = [
  publicProcedure('join', join, 'json'),
  cellProcedure('hello', cellRoute('hello')),
  cellProcedure('claim', claim),
  cellProcedure('heartbeat', cellRoute('heartbeat')),
  cellProcedure('submitCommand', submitCommand),
  cellProcedure('cellProjectEnsure'),
  supervisorProcedure('cellsList'),
  supervisorProcedure('cellRevoke'),
  supervisorProcedure('joinTokenCreate'),
  supervisorProcedure('joinTokenList'),
  supervisorProcedure('joinTokenRevoke'),
];
