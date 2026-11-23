import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const BASE_URL = 'http://127.0.0.1:7070';
const JOIN_URL = `${BASE_URL}/api/v1/tokens/join`;
const ROTATE_URL = `${BASE_URL}/api/v1/tokens/rotate`;
const JOIN_SECRET = 'join-secret-value';
const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const SESSION_EXPIRES_AT = NOW + 24 * HOUR_MS;

const factory = setupServer();

let session: typeof import('../../src/lib/session');
let dataDir: string;

const sessionReply = (token: string, expiresAt: number) =>
  HttpResponse.json({ code: 201, token, expiresAt }, { status: 201 });

const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );

const depsWithClock = (clock: () => number) => ({
  baseUrl: BASE_URL,
  dataDir,
  read: (path: string) => readFile(path, 'utf8'),
  clock,
});

const envFor = (dir: string) => ({
  HQ_URL: BASE_URL,
  HQ_PROJECT_ID: 'project-1',
  HQ_DATA_DIR: dir,
});

beforeAll(() => {
  factory.listen();
});

beforeEach(async () => {
  vi.resetModules();
  session = await import('../../src/lib/session');
  dataDir = await mkdtemp(join(tmpdir(), 'web-demo-join-'));
  await writeFile(join(dataDir, 'web-demo.join'), `${JOIN_SECRET}\n`);
});

afterEach(async () => {
  factory.resetHandlers();
  await rm(dataDir, { recursive: true, force: true });
});

afterAll(() => {
  factory.close();
});

describe('loopback registration', () => {
  it('registers from the join file and returns the session token', async () => {
    // Arrange
    let sentSecret: unknown;
    factory.use(
      http.post(JOIN_URL, async ({ request }) => {
        sentSecret = ((await request.json()) as { joinSecret: unknown })
          .joinSecret;
        return sessionReply('session-1', SESSION_EXPIRES_AT);
      }),
    );

    // Act
    const token = await session.currentToken(depsWithClock(() => NOW));

    // Assert
    expect(token).toBe('session-1');
    expect(sentSecret).toBe(JOIN_SECRET);
  });

  it('fails naming the join file path when the file is missing', async () => {
    // Arrange
    const missingDir = await mkdtemp(join(tmpdir(), 'web-demo-empty-'));

    // Act
    const failure = await rejectionOf(session.startSession(envFor(missingDir)));

    // Assert
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      join(missingDir, 'web-demo.join'),
    );
    await rm(missingDir, { recursive: true, force: true });
  });

  it('fails with the server code and message when the join is refused', async () => {
    // Arrange
    factory.use(
      http.post(JOIN_URL, () =>
        HttpResponse.json(
          { code: 401, type: 'unauthorized', message: 'Invalid join secret' },
          { status: 401 },
        ),
      ),
    );

    // Act
    const failure = await rejectionOf(session.startSession(envFor(dataDir)));

    // Assert
    expect((failure as Error).message).toBe('401: Invalid join secret');
    expect((failure as Error).message).not.toContain(JOIN_SECRET);
  });

  it('keeps the session while more than one hour of lifetime remains', async () => {
    // Arrange
    let rotations = 0;
    factory.use(
      http.post(JOIN_URL, () => sessionReply('session-1', SESSION_EXPIRES_AT)),
      http.post(ROTATE_URL, () => {
        rotations += 1;
        return sessionReply('session-2', SESSION_EXPIRES_AT + 24 * HOUR_MS);
      }),
    );
    const deps = depsWithClock(() => NOW + 22 * HOUR_MS);
    await session.currentToken(deps);

    // Act
    const token = await session.currentToken(deps);

    // Assert
    expect(token).toBe('session-1');
    expect(rotations).toBe(0);
  });

  it('rotates the session once less than one hour of lifetime remains', async () => {
    // Arrange
    let rotations = 0;
    factory.use(
      http.post(JOIN_URL, () => sessionReply('session-1', SESSION_EXPIRES_AT)),
      http.post(ROTATE_URL, () => {
        rotations += 1;
        return sessionReply('session-2', SESSION_EXPIRES_AT + 24 * HOUR_MS);
      }),
    );
    let now = NOW;
    const deps = depsWithClock(() => now);
    await session.currentToken(deps);
    now = NOW + 23.5 * HOUR_MS;

    // Act
    const token = await session.currentToken(deps);

    // Assert
    expect(token).toBe('session-2');
    expect(rotations).toBe(1);
  });

  it('joins again when a rotation is refused', async () => {
    // Arrange
    let joins = 0;
    factory.use(
      http.post(JOIN_URL, () => {
        joins += 1;
        return sessionReply(`session-${joins}`, SESSION_EXPIRES_AT);
      }),
      http.post(ROTATE_URL, () =>
        HttpResponse.json(
          { code: 401, type: 'unauthorized', message: 'Invalid token' },
          { status: 401 },
        ),
      ),
    );
    let now = NOW;
    const deps = depsWithClock(() => now);
    await session.currentToken(deps);
    now = NOW + 23.5 * HOUR_MS;

    // Act
    const token = await session.currentToken(deps);

    // Assert
    expect(token).toBe('session-2');
    expect(joins).toBe(2);
  });
});
