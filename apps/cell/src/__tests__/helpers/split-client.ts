import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { RouteName } from '@repo/factory-core/contracts/routes';

/**
 * The Cell's routes (PROTOCOL §1): a Cell credential admits these, and only these. Every other route
 * takes the supervisor token.
 */
const CELL_ROUTES: ReadonlySet<string> = new Set([
  'hello',
  'claim',
  'heartbeat',
  'submitCommand',
  'blobPut',
  'blobGet',
]);

/**
 * One FactoryClient over two credentials, picked by route: the Cell routes go through `cell` (a client
 * holding a Cell credential), every other route through `supervisor`. Over one transport a single client did
 * both; over HTTP a test needs both credentials, and this keeps the tests' calls as they were.
 */
export const splitClient = (
  supervisor: FactoryClient,
  cell: FactoryClient,
): FactoryClient =>
  ({
    call: (route, request) =>
      CELL_ROUTES.has(route as RouteName)
        ? cell.call(route, request as never)
        : supervisor.call(route, request as never),
  }) as FactoryClient;
