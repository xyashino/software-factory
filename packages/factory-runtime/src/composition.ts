import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  ROUTES,
  type ParsedRequest,
  type RouteName,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import { createCommandHandler, type CommandHandler } from './command-handler';
import { asRuntimeError } from './errors';
import { type CallOptions, createOperations } from './operations';
import { createNotifier } from './notifier';
import { bootGrace, reapOnce } from './reaper';
import type { RuntimePorts } from './ports';

/**
 * The runtime: the command loop, the claims, the heartbeats, the reaper and the Supervisor and Cell
 * operations, built from ports only. It opens no file, no socket and no port; a write needs the
 * writer lock held (see `WriterGuard`). Transports reach it through `call` or `client`.
 */
export interface Runtime {
  /** One route, with an already validated request (PROTOCOL §3). */
  call<K extends RouteName>(
    route: K,
    request: ParsedRequest<K>,
    options?: CallOptions,
  ): Promise<RouteResponse<K>>;
  /**
   * The same routes as a FactoryClient: each request is parsed by the route's schema and each
   * response is parsed back, exactly as the socket client does. Tests compare the two.
   */
  client: FactoryClient;
  /** One reaper pass; returns how many expired leases it looked at. */
  reapOnce(): Promise<number>;
  /**
   * The command loop itself, for intake (CreateOrder, v2-10) and for tests that set up a Work order.
   * Commits made through it wake the claims waiting on the queue, as any other commit does.
   */
  commands: CommandHandler;
  /** Boot grace, then the reaper every `reaperMs` (PROTOCOL §5.1, §5.4). Idempotent. */
  start(): Promise<void>;
  /** Stops the reaper timer. Pending long-polls end at their next tick. */
  stop(): void;
}

export const createRuntime = (ports: RuntimePorts): Runtime => {
  const notifier = createNotifier(ports.timers);
  const handler = createCommandHandler(ports, () => notifier.wake());
  const operations = createOperations(ports, handler, {
    ports,
    handler,
    notifier,
  });

  let running = false;
  let cancelTimer: () => void = () => undefined;

  const schedule = (): void => {
    cancelTimer = ports.timers.after(ports.config.reaperMs, () => {
      if (!running) return;
      reapOnce(ports, handler)
        .catch((error: unknown) => {
          console.error('factory reaper pass failed', error);
        })
        .finally(() => {
          if (running) schedule();
        });
    });
  };

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
    reapOnce: () => reapOnce(ports, handler),
    start: async () => {
      if (running) return;
      await bootGrace(ports);
      running = true;
      schedule();
    },
    stop: () => {
      running = false;
      cancelTimer();
    },
  };
};
