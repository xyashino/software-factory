import type { FactoryClient } from '@repo/factory-core/contracts/client';
import {
  ROUTES,
  type ParsedRequest,
  type RouteName,
  type RouteResponse,
} from '@repo/factory-core/contracts/routes';
import type { ProjectId } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { createAdmin, type RuntimeAdmin } from './admin';
import { createCommandHandler, type CommandHandler } from './command-handler';
import { asRuntimeError, notFound } from './errors';
import { feedFrom } from './feed';
import { syncProject, type IntakeReport } from './intake';
import { createNotifier } from './notifier';
import { type CallOptions, createOperations } from './operations';
import type { RuntimePorts, Timers } from './ports';
import { pollPrStates } from './pr-poll';
import { createRemoteAccess, type RemoteAccess } from './remote';
import { bootGrace, reapOnce } from './reaper';

/**
 * The runtime: the command loop, the claims, the heartbeats, the reaper, intake, the PR poll, the
 * event feed, the admin operations and the Supervisor and Cell operations, built from ports only.
 * It opens no file, no socket and no port; a write needs the writer lock held (see `WriterGuard`).
 * Transports reach it through `call`, `client`, `feed` and `admin`.
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
   * The command loop itself, for intake and for tests that set up a Work order.
   * Commits made through it wake the claims waiting on the queue, as any other commit does.
   */
  commands: CommandHandler;
  /** Intake now, for one project or for every registered project (PROTOCOL §3.1). */
  sync(projectId?: ProjectId): Promise<IntakeReport[]>;
  /** One PR state pass over the delivered Work orders; returns how many PRs it asked about (ROADMAP M4). */
  pollPrStates(): Promise<number>;
  /** Every stored event after `afterGlobalSeq`, then each new one, until `signal` aborts (PROTOCOL §3.1). */
  feed(
    afterGlobalSeq: number,
    signal?: AbortSignal,
  ): AsyncIterable<StoredEvent>;
  /** Backup, export, import and projection rebuild (STORAGE §7). The writer lock must be held. */
  admin: RuntimeAdmin;
  /** Credentials for the remote transport: join, token checks, supervisor token creation (PROTOCOL §1). */
  remote: RemoteAccess;
  /**
   * Boot grace, then the reaper every `reaperMs`, and the intake and PR poll loops at their own
   * intervals (PROTOCOL §5.1, §5.4). Idempotent.
   */
  start(): Promise<void>;
  /** Stops every timer. Pending long-polls end at their next tick. */
  stop(): void;
}

/** A timer loop: one pass, then the next after `ms`. Off when `ms` is 0. Passes never overlap. */
interface Loop {
  start(): void;
  stop(): void;
}

const repeating = (
  timers: Timers,
  name: string,
  ms: number,
  pass: () => Promise<unknown>,
): Loop => {
  let on = false;
  let cancel: () => void = () => undefined;
  const tick = (): void => {
    if (!on) return;
    pass()
      .catch((error: unknown) => {
        console.error(`factory ${name} pass failed`, error);
      })
      .finally(() => {
        if (on) cancel = timers.after(ms, tick);
      });
  };
  return {
    start: () => {
      if (ms <= 0 || on) return;
      on = true;
      cancel = timers.after(ms, tick);
    },
    stop: () => {
      on = false;
      cancel();
    },
  };
};

export const createRuntime = (ports: RuntimePorts): Runtime => {
  const notifier = createNotifier(ports.timers);
  const handler = createCommandHandler(ports, () => notifier.wake());
  const admin = createAdmin(ports, handler);

  const sync = async (projectId?: ProjectId): Promise<IntakeReport[]> => {
    const projects = (await ports.projects.list()).filter(
      (project) => projectId === undefined || project.projectId === projectId,
    );
    if (projectId !== undefined && projects.length === 0) throw notFound();
    const reports: IntakeReport[] = [];
    for (const project of projects) {
      reports.push(await syncProject(ports, handler, project));
    }
    return reports;
  };

  const operations = createOperations(
    ports,
    handler,
    { ports, handler, notifier },
    { sync, admin },
  );

  let running = false;
  let cancelReaper: () => void = () => undefined;

  const schedule = (): void => {
    cancelReaper = ports.timers.after(ports.config.reaperMs, () => {
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

  const loops: Loop[] = [
    repeating(ports.timers, 'intake', ports.config.intakePollMs, () => sync()),
    repeating(ports.timers, 'pr poll', ports.config.prPollMs, () =>
      pollPrStates(ports, handler),
    ),
  ];

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
    sync,
    pollPrStates: () => pollPrStates(ports, handler),
    feed: (afterGlobalSeq, signal) =>
      feedFrom(ports, notifier, afterGlobalSeq, signal),
    admin,
    remote: createRemoteAccess(ports),
    start: async () => {
      if (running) return;
      await bootGrace(ports);
      running = true;
      schedule();
      for (const loop of loops) loop.start();
    },
    stop: () => {
      running = false;
      cancelReaper();
      for (const loop of loops) loop.stop();
    },
  };
};
