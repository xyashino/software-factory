import { createApp } from '../../src/app';
import { createEventBus } from '../../src/adapters/memory/event-bus.adapter';
import { createTransport } from '../../src/bootstrap/transport';
import type { Db } from '../../src/db/client';
import type { EventBusPort } from '../../src/application/ports/event-bus.port';
import { createTestDb } from './test-db';
import {
  createFakeFactoryClient,
  createFakeRepoInspector,
  createFakeSupervisor,
  createFakeWorkspace,
  type FakeFactoryClient,
  type FakeRepoInspector,
  type FakeSupervisor,
  type FakeWorkspace,
} from './fakes';
import { createFakeClock, type FakeClock } from './test-transport';

export type TestApp = ReturnType<typeof createApp>;

export type TestContext = {
  app: TestApp;
  db: Db;
  clock: FakeClock;
  eventBus: EventBusPort;
  supervisor: FakeSupervisor;
  factoryClient: FakeFactoryClient;
  repoInspector: FakeRepoInspector;
  workspace: FakeWorkspace;
};

export const createTestApp = (): TestContext => {
  const db = createTestDb();
  const clock = createFakeClock();
  const eventBus = createEventBus();
  const supervisor = createFakeSupervisor();
  const factoryClient = createFakeFactoryClient();
  const repoInspector = createFakeRepoInspector();
  const workspace = createFakeWorkspace();
  const app = createApp(
    createTransport({
      db,
      clock,
      eventBus,
      supervisor,
      factoryClient,
      repoInspector,
      workspace,
    }),
  );
  return {
    app,
    db,
    clock,
    eventBus,
    supervisor,
    factoryClient,
    repoInspector,
    workspace,
  };
};

export const postJson = (
  app: TestApp,
  path: string,
  body: unknown,
): Promise<Response> =>
  Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

export const getJson = (app: TestApp, path: string): Promise<Response> =>
  Promise.resolve(app.request(path));

export const patchJson = (
  app: TestApp,
  path: string,
  body: unknown,
): Promise<Response> =>
  Promise.resolve(
    app.request(path, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

export const deleteJson = (app: TestApp, path: string): Promise<Response> =>
  Promise.resolve(app.request(path, { method: 'DELETE' }));
