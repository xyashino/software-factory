import { createApp } from '../../src/app';
import { createSafeTokenAuth } from '../../src/adapters/auth/safe-token-auth.adapter';
import { createClaimWaiters } from '../../src/adapters/memory/claim-waiters.adapter';
import { createTransitionBus } from '../../src/adapters/memory/transition-bus.adapter';
import { createSqliteStorageAdapter } from '../../src/adapters/storage/sqlite-storage.adapter';
import type {
  AuthPort,
  TokenScope,
} from '../../src/application/ports/auth.port';
import type { TransitionBusPort } from '../../src/application/ports/transition-bus.port';
import type { StoragePort } from '../../src/application/ports/storage.port';
import { createTransport } from '../../src/bootstrap/transport';
import { asTokenId } from '../../src/domain/common/brand';
import { createTestDb } from './test-db';
import { createFakeClock, type FakeClock } from './test-transport';

export const VALID_TOKEN = 'valid-token';

const rejectAllAuth: AuthPort = {
  verify: () => Promise.resolve(null),
};

export const grantingAuth = (scopes: readonly TokenScope[]): AuthPort => ({
  verify: (bearer) =>
    Promise.resolve(
      bearer === VALID_TOKEN
        ? { tokenId: asTokenId('token-1'), factoryId: null, scopes }
        : null,
    ),
});

type TestAppOptions = {
  auth?: AuthPort;
  safeTokenAuth?: boolean;
  transitionBus?: TransitionBusPort;
};

export type TestApp = ReturnType<typeof createApp>;

export const createTestApp = (
  options: TestAppOptions = {},
): {
  app: TestApp;
  clock: FakeClock;
  db: ReturnType<typeof createTestDb>;
  storage: StoragePort;
  transitionBus: TransitionBusPort;
} => {
  const db = createTestDb();
  const storage = createSqliteStorageAdapter(db);
  const clock = createFakeClock();
  const auth = options.safeTokenAuth
    ? createSafeTokenAuth(storage, clock)
    : (options.auth ?? rejectAllAuth);
  const transitionBus = options.transitionBus ?? createTransitionBus();
  const app = createApp(
    createTransport({
      storage,
      clock,
      auth,
      claimWaiters: createClaimWaiters(),
      transitionBus,
    }),
  );
  return { app, clock, db, storage, transitionBus };
};

export const postJson = (
  app: TestApp,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> =>
  Promise.resolve(
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

export const deleteJson = (
  app: TestApp,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> =>
  Promise.resolve(app.request(path, { method: 'DELETE', headers }));

export const getJson = (
  app: TestApp,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> => Promise.resolve(app.request(path, { headers }));
