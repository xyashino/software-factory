import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse, passthrough } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

const APP_DIR = fileURLToPath(new URL('../..', import.meta.url));
const FACTORY_URL = 'http://factory.test';
const TOKEN = 'token-value-that-must-not-leak';
const PORT_RANGE_START = 30_000;
const PORT_RANGE_SIZE = 20_000;
const BUILD_TIMEOUT_MS = 120_000;
const LOCAL_PAGES = /^http:\/\/127\.0\.0\.1[:/]/;
const TRANSITIONS = `${FACTORY_URL}/api/v1/work-orders/order-1/transitions`;

const factory = setupServer(http.all(LOCAL_PAGES, () => passthrough()));

const order = {
  orderId: 'order-1',
  projectId: 'project-1',
  slug: 'add-login',
  title: 'Add login',
  type: 'feat',
  lineName: 'main',
  priority: 'high',
  state: 'paused',
  branch: 'factory/add-login',
  staleBase: false,
  currentStepIndex: 2,
  pinnedFactoryId: null,
  activeCellId: null,
  activeJobId: null,
  version: 3,
  updatedAt: Date.UTC(2026, 10, 19, 11, 30, 0),
};

const detailReply = {
  code: 200,
  order,
  steps: [],
  jobs: [],
  incidents: [],
};

type RunningServer = { port: number; stop: () => Promise<void> };
type Call = { body: unknown };

let app: RunningServer;
let calls: Call[];

const pageUrl = (path: string): string => `http://127.0.0.1:${app.port}${path}`;

const submit = (
  path: string,
  init: { origin?: string; form?: Record<string, string> },
): Promise<Response> =>
  fetch(pageUrl(path), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      ...(init.origin === undefined ? {} : { origin: init.origin }),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(init.form ?? {}).toString(),
  });

const readPage = async (path: string): Promise<string> => {
  const response = await fetch(pageUrl(path));
  return response.text();
};

const transitionHandler = (reply: Response | (() => Response)) =>
  http.post(TRANSITIONS, async ({ request }) => {
    calls.push({ body: await request.json() });
    return typeof reply === 'function' ? reply() : reply;
  });

const ok = () =>
  HttpResponse.json({ code: 200, order: { ...order, state: 'queued' } });

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

const useDetailInState = (state: string): void => {
  factory.use(
    http.get(`${FACTORY_URL}/api/v1/work-orders/order-1`, () =>
      HttpResponse.json({ ...detailReply, order: { ...order, state } }),
    ),
  );
};

beforeEach(() => {
  calls = [];
  useDetailInState('paused');
});

afterEach(() => factory.resetHandlers());

afterAll(async () => {
  await app.stop();
  factory.close();
});

describe('work order write actions', () => {
  it('shows Resume on a blocked order', async () => {
    // Arrange
    useDetailInState('blocked');

    // Act
    const page = await readPage('/work-orders/order-1');

    // Assert
    expect(page).toContain('/actions/work-orders/order-1/resume');
  });

  it('hides Resume on a paused order, which the factory only unpauses', async () => {
    // Arrange
    useDetailInState('paused');

    // Act
    const page = await readPage('/work-orders/order-1');

    // Assert
    expect(page).not.toContain('/actions/work-orders/order-1/resume');
  });

  it('opens an order whose id carries a colon', async () => {
    // Arrange
    factory.use(
      http.get(`${FACTORY_URL}/api/v1/work-orders/project-1%3Aorder-1`, () =>
        HttpResponse.json({
          ...detailReply,
          order: { ...order, orderId: 'project-1:order-1' },
        }),
      ),
    );

    // Act
    const response = await fetch(pageUrl('/work-orders/project-1%3Aorder-1'));

    // Assert
    expect(response.status).toBe(200);
  });

  it('hides Delete on a cancelled order', async () => {
    // Arrange
    factory.use(
      http.get(`${FACTORY_URL}/api/v1/work-orders/order-1`, () =>
        HttpResponse.json({
          ...detailReply,
          order: { ...order, state: 'cancelled' },
        }),
      ),
    );

    // Act
    const page = await readPage('/work-orders/order-1');

    // Assert
    expect(page).not.toContain('/actions/work-orders/order-1/cancel');
  });

  it('resumes an order and redirects with a notice', async () => {
    // Arrange
    factory.use(transitionHandler(ok()));

    // Act
    const response = await submit('/actions/work-orders/order-1/resume', {
      origin: `http://127.0.0.1:${app.port}`,
    });

    // Assert
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain(
      '/work-orders/order-1?notice=',
    );
    expect(calls).toEqual([{ body: { action: 'resume' } }]);
  });

  it('answers 403 and sends nothing for a foreign origin', async () => {
    // Arrange
    factory.use(transitionHandler(ok()));

    // Act
    const response = await submit('/actions/work-orders/order-1/resume', {
      origin: 'https://evil.test',
    });

    // Assert
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('answers 403 and sends nothing when the origin is missing', async () => {
    // Arrange
    factory.use(transitionHandler(ok()));

    // Act
    const response = await submit('/actions/work-orders/order-1/resume', {});

    // Assert
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('answers 400 and sends nothing for an action outside the allow-list', async () => {
    // Arrange
    factory.use(transitionHandler(ok()));

    // Act
    const response = await submit('/actions/work-orders/order-1/pause', {
      origin: `http://127.0.0.1:${app.port}`,
    });

    // Assert
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('answers 400 and sends nothing when cancel lacks the confirm checkbox', async () => {
    // Arrange
    factory.use(transitionHandler(ok()));

    // Act
    const response = await submit('/actions/work-orders/order-1/cancel', {
      origin: `http://127.0.0.1:${app.port}`,
    });

    // Assert
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('cancels a confirmed order by sending the cancel action', async () => {
    // Arrange
    factory.use(transitionHandler(ok()));

    // Act
    const response = await submit('/actions/work-orders/order-1/cancel', {
      origin: `http://127.0.0.1:${app.port}`,
      form: { confirm: 'yes' },
    });

    // Assert
    expect(response.status).toBe(303);
    expect(calls).toEqual([{ body: { action: 'cancel' } }]);
  });

  it('redirects a factory conflict back with its code and message', async () => {
    // Arrange
    factory.use(
      transitionHandler(
        HttpResponse.json(
          { code: 409, type: 'conflict', message: 'order is busy' },
          { status: 409 },
        ),
      ),
    );

    // Act
    const response = await submit('/actions/work-orders/order-1/resume', {
      origin: `http://127.0.0.1:${app.port}`,
    });

    // Assert
    expect(response.status).toBe(303);
    const location = new URL(
      response.headers.get('location') ?? '',
      pageUrl('/'),
    );
    expect(location.pathname).toBe('/work-orders/order-1');
    expect(location.searchParams.get('error')).toBe('conflict: order is busy');
  });

  it('shows the conflict on the order page', async () => {
    // Arrange
    // Act
    const page = await readPage(
      `/work-orders/order-1?error=${encodeURIComponent('conflict: order is busy')}`,
    );

    // Assert
    expect(page).toContain('conflict: order is busy');
  });

  it('never shows the session token after a write', async () => {
    // Arrange
    factory.use(transitionHandler(ok()));

    // Act
    const response = await submit('/actions/work-orders/order-1/resume', {
      origin: `http://127.0.0.1:${app.port}`,
    });
    const location = response.headers.get('location') ?? '';

    // Assert
    expect(location).not.toContain(TOKEN);
    expect(await readPage('/work-orders/order-1')).not.toContain(TOKEN);
  });
});
