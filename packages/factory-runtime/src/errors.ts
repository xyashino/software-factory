import {
  domainErrorToWire,
  invalidWire,
  WIRE_STATUS,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import type { DomainError } from '@repo/factory-core/order/commands';

/**
 * A refusal the runtime returns to its caller. It carries the wire error, so every transport maps it
 * the same way: a status from `WIRE_STATUS` and the body of `wireErrorSchema`.
 */
export class RuntimeError extends Error {
  readonly wire: WireError;
  readonly status: number;

  constructor(wire: WireError) {
    super(`factory refused the request: ${wire.code}`);
    this.name = 'RuntimeError';
    this.wire = wire;
    this.status = WIRE_STATUS[wire.code];
  }
}

/** A domain refusal (`decide`, CORE §5.2) as a RuntimeError. Nothing was appended. */
export const refusal = (error: DomainError): RuntimeError =>
  new RuntimeError(domainErrorToWire(error));

/** Retries exhausted (STORAGE §3): the caller may send the same command again. */
export const unavailable = (): RuntimeError =>
  new RuntimeError({ code: 'unavailable' });

/** The Cell is unknown or revoked. */
export const unauthorized = (): RuntimeError =>
  new RuntimeError({ code: 'unauthorized' });

/** A Work order that does not exist. */
export const notFound = (): RuntimeError =>
  new RuntimeError({ code: 'not_found' });

export const isRuntimeError = (error: unknown): error is RuntimeError =>
  error instanceof RuntimeError;

/** A Zod failure, by its shape: any error that carries a list of issues. */
const isIssueError = (
  error: unknown,
): error is { issues: { path: PropertyKey[]; message: string }[] } =>
  error instanceof Error &&
  Array.isArray((error as { issues?: unknown }).issues);

/**
 * The RuntimeError a thrown error stands for. A schema failure becomes `invalid` (422) with its
 * issues, as the socket answers it; anything else is not a refusal and is rethrown.
 */
export const asRuntimeError = (error: unknown): RuntimeError => {
  if (error instanceof RuntimeError) return error;
  if (isIssueError(error)) return new RuntimeError(invalidWire(error.issues));
  throw error;
};
