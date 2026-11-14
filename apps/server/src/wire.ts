import {
  invalidWire,
  WIRE_STATUS,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import { isRuntimeError } from '@repo/factory-runtime/errors';

/**
 * The answers both transports share (PROTOCOL §3.5): a JSON body with a status, and the mapping of a
 * failure to its wire error. The Unix socket and the TCP listener call these, so an error reads the
 * same whichever transport carried it.
 */

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A refusal in its wire form: the status of its code, and the wire body. */
export const refusedResponse = (error: WireError): Response =>
  jsonResponse(WIRE_STATUS[error.code], error);

/** A Zod failure raised while the runtime parsed an internal payload, by its shape. */
const isIssueError = (
  error: unknown,
): error is { issues: { path: PropertyKey[]; message: string }[] } =>
  error instanceof Error &&
  Array.isArray((error as { issues?: unknown }).issues);

/**
 * The answer for an error the runtime or a parser raised. A refusal keeps its status and its wire
 * body; an unexpected failure answers 503 `unavailable`, so the caller may retry with the same
 * commandId. The label names the route in the log; the error text itself is logged, never a token.
 */
export const failureResponse = (error: unknown, label: string): Response => {
  if (isRuntimeError(error)) return refusedResponse(error.wire);
  if (isIssueError(error)) return refusedResponse(invalidWire(error.issues));
  console.error(`factory-server: ${label} failed`, error);
  return refusedResponse({ code: 'unavailable' });
};
