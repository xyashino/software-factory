import { createApp } from '../../src/app';
import { createEventBus } from '../../src/adapters/memory/event-bus.adapter';
import { createTransport } from '../../src/bootstrap/transport';
import type { Db } from '../../src/db/client';
import { createTestDb } from './test-db';
import { createFakeClock, type FakeClock } from './test-transport';

export type TestApp = ReturnType<typeof createApp>;

export const createTestApp = (): {
  app: TestApp;
  db: Db;
  clock: FakeClock;
} => {
  const db = createTestDb();
  const clock = createFakeClock();
  const app = createApp(
    createTransport({ db, clock, eventBus: createEventBus() }),
  );
  return { app, db, clock };
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
