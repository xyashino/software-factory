import { ROUTES, type RouteName } from '@repo/factory-core/contracts/routes';
import {
  invalidWire,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import { isRuntimeError } from '@repo/factory-runtime/errors';
import {
  WriterHeldError,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { isRefusal, toWireError } from './application/core/error-handling';
import { withRouteSchema } from './application/core/schema/zod';
import { openForAdmin } from './admin-command';

/** Exit codes of `factory-server --once` (PROTOCOL §10): the CLI tells them apart. */
export const ONCE_EXIT = {
  ok: 0,
  failed: 1,
  refused: 2,
  writerHeld: 3,
} as const;

/** What `--once` prints on stdout: the parsed response, or the wire error of a refusal. */
export type OnceOutput =
  { ok: true; response: unknown } | { ok: false; error: WireError };

/**
 * One-shot mode (PROTOCOL §10): takes the writer lock, runs one route of the runtime, prints its
 * answer as JSON and releases the lock. No reaper, no boot grace, no socket, no port. Used by the CLI
 * when no `factory-server` runs, so a write still goes through the same command loop.
 */
export const runOnce = async (
  dataDir: string,
  stdin: string,
): Promise<{ exitCode: number; output: OnceOutput }> => {
  let opened: OpenedRuntime;
  try {
    opened = openForAdmin(dataDir);
  } catch (error) {
    if (error instanceof WriterHeldError) {
      return {
        exitCode: ONCE_EXIT.writerHeld,
        output: { ok: false, error: { code: 'unavailable' } },
      };
    }
    throw error;
  }
  try {
    const input = parseInput(stdin);
    if (!input.ok) {
      return {
        exitCode: ONCE_EXIT.refused,
        output: { ok: false, error: input.error },
      };
    }
    const route = input.route;
    // A one-shot holds the writer lock for its whole run, so a long-poll here would block every other
    // process (a server starting up, the next one-shot) for the full wait. It answers at once instead.
    const parsed = withRouteSchema(route)(input.request);
    const request =
      route === 'supervisorEvents' ? { ...parsed, waitMs: 0 } : parsed;
    const response = await opened.runtime.call(route, request as never);
    return {
      exitCode: ONCE_EXIT.ok,
      output: { ok: true, response: ROUTES[route].response.parse(response) },
    };
  } catch (error) {
    // A refusal is the request's fault (exit 2); a failure in the response's parse is not (exit 1).
    if (isRefusal(error) || isRuntimeError(error)) {
      return {
        exitCode: ONCE_EXIT.refused,
        output: { ok: false, error: toWireError(error) },
      };
    }
    console.error('factory-server --once failed', error);
    return {
      exitCode: ONCE_EXIT.failed,
      output: { ok: false, error: { code: 'unavailable' } },
    };
  } finally {
    opened.close();
  }
};

type ParsedInput =
  | { ok: true; route: RouteName; request: unknown }
  | { ok: false; error: WireError };

const parseInput = (stdin: string): ParsedInput => {
  let json: unknown;
  try {
    json = JSON.parse(stdin);
  } catch {
    return {
      ok: false,
      error: invalidWire([{ path: [], message: 'the input is not JSON' }]),
    };
  }
  const envelope =
    typeof json === 'object' && json !== null && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : undefined;
  if (
    !envelope ||
    typeof envelope.route !== 'string' ||
    !('request' in envelope)
  ) {
    return {
      ok: false,
      error: invalidWire([
        { path: [], message: 'the input must be {"route", "request"}' },
      ]),
    };
  }
  const route = (Object.keys(ROUTES) as RouteName[]).find(
    (name) => name === envelope.route,
  );
  if (!route) return { ok: false, error: { code: 'not_found' } };
  return { ok: true, route, request: envelope.request };
};
