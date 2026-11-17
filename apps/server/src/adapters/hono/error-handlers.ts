import type { Context } from 'hono';
import { refusedResponse } from './wire';
import { isExpected, toWireError } from '../../application/core/error-handling';

/**
 * The one error handler of the app (PROTOCOL §3.5): every failure a procedure or a route raises becomes
 * its wire error. An unexpected failure is logged under its route, never with a token; it answers 503.
 */
export const errorHandler = (error: Error, c: Context): Response => {
  if (!isExpected(error)) {
    console.error(
      `factory-server: ${c.req.method} ${c.req.routePath} failed`,
      error,
    );
  }
  return refusedResponse(toWireError(error));
};

/** An unknown path answers 404 `not_found` (PROTOCOL §3.5). */
export const notFoundHandler = (): Response =>
  refusedResponse({ code: 'not_found' });
