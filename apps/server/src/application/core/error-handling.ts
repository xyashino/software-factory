import {
  invalidWire,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import { isRuntimeError } from '@repo/factory-runtime/errors';

/** A refusal raised by the application layer, carrying the wire error it answers with (PROTOCOL §3.5). */
export class RefusalError extends Error {
  readonly wire: WireError;

  constructor(wire: WireError, options?: { cause?: unknown }) {
    super(wire.code, options);
    this.name = 'RefusalError';
    this.wire = wire;
  }
}

export const isRefusal = (error: unknown): error is RefusalError =>
  error instanceof RefusalError;

/** A Zod failure, by its shape: any error that carries a list of issues. */
const isIssueError = (
  error: unknown,
): error is { issues: { path: PropertyKey[]; message: string }[] } =>
  error instanceof Error &&
  Array.isArray((error as { issues?: unknown }).issues);

/** Whether the error is one the protocol names (a refusal, a runtime refusal, or a validation failure). */
export const isExpected = (error: unknown): boolean =>
  isRefusal(error) || isRuntimeError(error) || isIssueError(error);

/**
 * The wire error of any failure. A refusal keeps its wire body, a validation failure becomes `invalid`,
 * and anything unexpected answers `unavailable`, so the caller may retry with the same commandId.
 */
export const toWireError = (error: unknown): WireError => {
  if (isRefusal(error)) return error.wire;
  if (isRuntimeError(error)) return error.wire;
  if (isIssueError(error)) return invalidWire(error.issues);
  return { code: 'unavailable' };
};
