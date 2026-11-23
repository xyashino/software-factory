import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse, passthrough } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const FACTORY_URL = 'http://factory.test';
const TOKEN = 'token-value-that-must-not-leak';
const PORT_RANGE_START = 30_000;
const PORT_RANGE_SIZE = 20_000;
const BUILD_TIMEOUT_MS = 120_000;

const LOCAL_PAGES = /^http:\/\/127\.0\.0\.1[:/]/;

const factory = setupServer(http.all(LOCAL_PAGES, () => passthrough()));

const laptop = {
  factoryId: 'factory-1',
  name: 'laptop',
  lastSeenAt: Date.UTC(2026, 10, 19, 11, 59, 0),
  online: true,
  projects: [{ projectId: 'project-1', desired: 2, running: 1 }],
};

const order = {
  orderId: 'order-1',
  projectId: 'project-1',
  slug: 'add-login',
  title: 'Add login',
  type: 'feat',
  lineName: 'main',
  priority: 'high',
  state: 'running',
  branch: 'factory/add-login',
  staleBase: false,
  currentStepIndex: 2,
  pinnedFactoryId: 'factory-1',
  activeCellId: 'cell-1',
  activeJobId: 'job-7',
  version: 3,
  updatedAt: Date.UTC(2026, 10, 19, 11, 30, 0),
};

const incident = {
  incidentId: 'incident-1',
  projectId: 'project-1',
  orderId: 'order-1',
  failedStepId: null,
  reason: 'step_retries_exhausted',
  detail: 'unit tests red',
  status: 'open',
  triageOwner: 'supervisor',
  createdAt: Date.UTC(2026, 10, 19, 10, 0, 0),
  resolvedAt: null,
};

const happyHandlers = [
  http.get(`${FACTORY_URL}/api/v1/factories`, () =>
    HttpResponse.json({ code: 200, factories: [laptop] }),
  ),
  http.get(`${FACTORY_URL}/api/v1/work-orders`, () =>
    HttpResponse.json({ code: 200, items: [order] }),
  ),
  http.get(`${FACTORY_URL}/api/v1/work-orders/order-1`, () =>
    HttpResponse.json({
      code: 200,
      order,
      steps: [
        {
          stepId: 'step-1',
          stepIndex: 0,
          stationId: 'plan',
          kind: 'plan',
          state: 'done',
        },
      ],
      jobs: [
        { jobId: 'job-7', kind: 'build', status: 'running', cellId: 'cell-1' },
      ],
      incidents: [],
    }),
  ),
  http.get(`${FACTORY_URL}/api/v1/incidents`, () =>
    HttpResponse.json({ code: 200, items: [incident] }),
  ),
];

type RunningServer = { port: number; stop: () => Promise<void> };

let app: RunningServer;

const pageUrl = (path: string): string => `http://127.0.0.1:${app.port}${path}`;

const readBody = async (
  path: string,
): Promise<{ status: number; body: string }> => {
  const response = await fetch(pageUrl(path));
  return { status: response.status, body: await response.text() };
};

beforeAll(async () => {
  execFileSync('bun', ['run', 'astro', 'build'], {
    cwd: APP_DIR,
    stdio: 'ignore',
  });
  factory.listen();

  Object.assign(process.env, {
    ASTRO_NODE_AUTOSTART: 'disabled',
    FACTORY_URL,
    FACTORY_PROJECT_ID: 'project-1',
    FACTORY_TOKEN: TOKEN,
    HOST: '127.0.0.1',
    PORT: String(
      PORT_RANGE_START + Math.floor(Math.random() * PORT_RANGE_SIZE),
    ),
  });

  const entry = (await import(
    fileURLToPath(new URL('../../dist/server/entry.mjs', import.meta.url))
  )) as {
    startServer: () => { server: RunningServer };
  };
  app = entry.startServer().server;
}, BUILD_TIMEOUT_MS);

afterEach(() => factory.resetHandlers());

afterAll(async () => {
  await app.stop();
  factory.close();
});

describe('read pages', () => {
  it('serves every read page when the factory answers', async () => {
    // Arrange
    factory.use(...happyHandlers);
    const paths = [
      '/',
      '/factories',
      '/work-orders',
      '/work-orders/order-1',
      '/incidents',
    ];

    // Act
    const pages = await Promise.all(paths.map(readBody));

    // Assert
    expect(pages.map((page) => page.status)).toEqual([200, 200, 200, 200, 200]);
    const readOnlyPages = pages.filter(
      (_, index) => paths[index] !== '/work-orders/order-1',
    );
    expect(readOnlyPages.some((page) => /<form|<script/.test(page.body))).toBe(
      false,
    );
  });

  it('lists the projects each factory reports as desired and running', async () => {
    // Arrange
    factory.use(...happyHandlers);

    // Act
    const page = await readBody('/factories');

    // Assert
    expect(page.body).toContain('laptop');
    expect(page.body).toContain('project-1 2 / 1');
  });

  it('answers 400 for an unknown state filter without calling the factory', async () => {
    // Arrange
    let factoryCalled = false;
    factory.use(
      http.get(`${FACTORY_URL}/api/v1/work-orders`, () => {
        factoryCalled = true;
        return HttpResponse.json({ code: 200, items: [] });
      }),
    );

    // Act
    const page = await readBody('/work-orders?state=bogus');

    // Assert
    expect(page.status).toBe(400);
    expect(factoryCalled).toBe(false);
  });

  it('answers 503 when the factory fails', async () => {
    // Arrange
    factory.use(
      http.get(`${FACTORY_URL}/api/v1/factories`, () =>
        HttpResponse.json({ type: 'internal' }, { status: 500 }),
      ),
    );

    // Act
    const page = await readBody('/factories');

    // Assert
    expect(page.status).toBe(503);
    expect(page.body).toBe('factory-server unreachable');
  });

  it('never shows the session token in a page', async () => {
    // Arrange
    factory.use(...happyHandlers);
    const paths = [
      '/',
      '/factories',
      '/work-orders',
      '/work-orders/order-1',
      '/incidents',
    ];

    // Act
    const pages = await Promise.all(paths.map(readBody));

    // Assert
    expect(pages.some((page) => page.body.includes(TOKEN))).toBe(false);
  });
});
