import { invalidWire } from '@repo/factory-core/contracts/errors';
import {
  ROUTES,
  type ParsedRequest,
  type RouteName,
} from '@repo/factory-core/contracts/routes';
import { RefusalError } from '../error-handling';
import type { ZodContract } from './types';

/**
 * Parses a request with the route's `ROUTES` schema (PROTOCOL §3). A failure throws a `invalid`
 * refusal listing its issues.
 */
export const withRouteSchema =
  (route: RouteName) =>
  (input: unknown): ParsedRequest<RouteName> => {
    const parsed = ROUTES[route].request.safeParse(input);
    if (!parsed.success) {
      throw new RefusalError(invalidWire(parsed.error.issues));
    }
    return parsed.data;
  };

/** Parses a request with a schema that is not a `ROUTES` entry, such as the join call or the webhook. */
export const withZodSchema =
  <T>(schema: ZodContract<T>) =>
  (input: unknown): T => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new RefusalError(invalidWire(parsed.error.issues));
    }
    return parsed.data;
  };
