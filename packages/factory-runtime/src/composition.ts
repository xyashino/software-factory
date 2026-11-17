import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  ROUTES,
  type ParsedRequest,
  type RouteName,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { createAdmin, type RuntimeAdmin } from './admin';
import { createCommandHandler, type CommandHandler } from './command-handler';
import { asRuntimeError } from './errors';
import { feedFrom } from './feed';
import { createNotifier } from './notifier';
import { type CallOptions, createOperations } from './operations';
import type { RuntimePorts } from './ports';
import { recordPullRequest, type PullRequestChange } from './pull-request';
import { createReaper } from './reaper';
import { createRemoteAccess, type RemoteAccess } from './remote';
import { revocations } from './revocations';

/**
 * The runtime: the command loop, the claims, the heartbeats, the lazy lease reaper, the event feed, the
 * admin operations, the Supervisor and Cell operations and the pull request records, built from ports
 * only. It runs no timer, reads no repository and runs no git or gh. It opens no file, no socket and no
 * port; a write needs the writer lock held (see `WriterGuard`). Transports reach it through `call`,
 * `client`, `feed`, `admin`, `remote` and `recordPullRequest`.
 */
export interface Runtime {
  /** One route, with an already validated request. */
  call<K extends RouteName>(
    route: K,
    request: ParsedRequest<K>,
    options?: CallOptions,
  ): Promise<RouteResponse<K>>;
  /**
   * The same routes as a FactoryClient: each request is parsed by the route's schema and each
   * response is parsed back, exactly as the HTTP clients do. Tests compare the two.
   */
  client: FactoryClient;
  /**
   * One reaper pass over the expired leases, unless boot grace still holds. Claim,
   * heartbeat and the board reads run it lazily; this is the same pass for a caller that wants it now.
   * Returns how many expired leases it looked at.
   */
  reapOnce(): Promise<number>;
  /**
   * The command loop itself, for tests that set up a Work order.
   * Commits made through it wake the claims waiting on the queue, as any other commit does.
   */
  commands: CommandHandler;
  /**
   * Records a pull request's state on the Work orders and Order Plans holding its URL (the
   * GitHub webhook). Returns how many streams changed; a repeated delivery changes none.
   */
  recordPullRequest(change: PullRequestChange): Promise<number>;
  /** Every stored event after `afterGlobalSeq`, then each new one, until `signal` aborts. */
  feed(
    afterGlobalSeq: number,
    signal?: AbortSignal,
  ): AsyncIterable<StoredEvent>;
  /** Backup, export, import and projection rebuild. The writer lock must be held. */
  admin: RuntimeAdmin;
  /** Credentials for the remote transport: join, token checks, supervisor token creation. */
  remote: RemoteAccess;
  /**
   * Arms boot grace: every lease gets a full TTL from now, and no lease is reaped until
   * that grace has passed. Arms nothing else: no timer is registered. Idempotent.
   */
  start(): Promise<void>;
  /** Marks the runtime stopped. It holds no timer, so nothing else needs cancelling. Pending long-polls end at their next tick. */
  stop(): void;
}

export const createRuntime = (ports: RuntimePorts): Runtime => {
  const notifier = createNotifier(ports.timers);
  const handler = createCommandHandler(ports, () => notifier.wake());
  const admin = createAdmin(ports, handler);
  const reaper = createReaper(ports, handler);

  const revoked = revocations();
  const operations = createOperations(
    ports,
    handler,
    { ports, handler, notifier, reap: () => reaper.reap() },
    { admin, revoked: (revocation) => revoked.emit(revocation) },
  );

  let running = false;

  const call = <K extends RouteName>(
    route: K,
    request: ParsedRequest<K>,
    options?: CallOptions,
  ): Promise<RouteResponse<K>> => operations.call(route, request, options);

  const client: FactoryClient = {
    call: async (route, request) => {
      let parsed: unknown;
      try {
        parsed = ROUTES[route].request.parse(request);
      } catch (error) {
        throw asRuntimeError(error);
      }
      const response = await operations.call(route, parsed as never);
      return ROUTES[route].response.parse(response) as never;
    },
  };

  return {
    call,
    client,
    commands: handler,
    reapOnce: () => reaper.reap(),
    recordPullRequest: (change) => recordPullRequest(ports, handler, change),
    feed: (afterGlobalSeq, signal) =>
      feedFrom(ports, notifier, afterGlobalSeq, signal),
    admin,
    remote: createRemoteAccess(ports, revoked),
    start: async () => {
      if (running) return;
      await reaper.arm();
      running = true;
    },
    stop: () => {
      running = false;
    },
  };
};
