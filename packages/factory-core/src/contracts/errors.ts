import { z } from 'zod';
import type { DomainError } from '../order/commands';

/**
 * The wire form of every refusal (PROTOCOL §3.5). A domain refusal keeps its shape; the transport
 * adds `unavailable` (503, after the retry budget) and `unauthorized` (a revoked or unknown Worker).
 */
export const wireErrorSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('not_found') }).strict(),
  z
    .object({ code: z.literal('stale_epoch'), current: z.number().int() })
    .strict(),
  z.object({ code: z.literal('not_live'), cycleId: z.string() }).strict(),
  z.object({ code: z.literal('precondition'), detail: z.string() }).strict(),
  z
    .object({ code: z.literal('invalid'), issues: z.array(z.string()) })
    .strict(),
  z.object({ code: z.literal('unavailable') }).strict(),
  z.object({ code: z.literal('unauthorized') }).strict(),
]);

export type WireError = z.infer<typeof wireErrorSchema>;
export type WireErrorCode = WireError['code'];

/** HTTP-like status of each code; the socket transport answers with it. */
export const WIRE_STATUS: Record<WireErrorCode, number> = {
  not_found: 404,
  stale_epoch: 409,
  not_live: 409,
  precondition: 409,
  invalid: 422,
  unavailable: 503,
  unauthorized: 401,
};

/** A domain refusal in its wire form. The shapes are the same by construction. */
export const domainErrorToWire = (error: DomainError): WireError => {
  switch (error.code) {
    case 'not_found':
      return { code: 'not_found' };
    case 'stale_epoch':
      return { code: 'stale_epoch', current: error.current };
    case 'not_live':
      return { code: 'not_live', cycleId: error.cycleId };
    case 'precondition':
      return { code: 'precondition', detail: error.detail };
    case 'invalid':
      return { code: 'invalid', issues: error.issues };
  }
};

/**
 * The wire form of a failed request schema: `invalid` with one line per issue, `path: message`.
 * Takes the issue shape Zod reports, so no caller needs Zod's error class.
 */
export const invalidWire = (
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): WireError => ({
  code: 'invalid',
  issues: issues.map(
    (issue) =>
      `${issue.path.map(String).join('.') || '(body)'}: ${issue.message}`,
  ),
});

/** Thrown by a client when the server answers with a wire error. */
export class WireFailure extends Error {
  readonly status: number;
  readonly error: WireError;

  constructor(error: WireError, status = WIRE_STATUS[error.code]) {
    super(`factory refused the request: ${error.code}`);
    this.name = 'WireFailure';
    this.error = error;
    this.status = status;
  }
}
