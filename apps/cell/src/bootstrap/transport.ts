import type { CreateTransport } from '../adapters/hono/types';
import type { ClockPort } from '../application/ports/clock.port';
import type { EventBusPort } from '../application/ports/event-bus.port';
import type { FactoryClientPort } from '../application/ports/factory-client.port';
import type { RepoInspectorPort } from '../application/ports/repo-inspector.port';
import type { SupervisorPort } from '../application/ports/supervisor.port';
import type { WorkspacePort } from '../application/ports/workspace.port';
import type { Db } from '../db/client';

export type TransportDeps = {
  db: Db;
  clock: ClockPort;
  eventBus: EventBusPort;
  supervisor: SupervisorPort;
  factoryClient: FactoryClientPort;
  repoInspector: RepoInspectorPort;
  workspace: WorkspacePort;
};

export const createTransport =
  (deps: TransportDeps): CreateTransport =>
  (request) => ({
    ...deps,
    signal: request.signal,
    remoteAddress: request.remoteAddress,
  });
