import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFactoryClient } from '../../src/lib/factory-client';
import { FactoryUnavailable } from '../../src/lib/factory-error';

const BASE_URL = 'http://factory.test';
const TOKEN = 'token-value-that-must-not-leak';

const server = setupServer();

const captureError = async (
  run: () => Promise<unknown>,
): Promise<FactoryUnavailable> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof FactoryUnavailable) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
};

const client = () =>
  createFactoryClient({ baseUrl: BASE_URL, getToken: () => TOKEN });

const cellReply = {
  code: 200,
  cells: [
    {
      cellId: 'cell-1',
      projectId: 'project-1',
      name: 'alpha',
      status: 'online',
      allowedLines: ['main'],
      runners: ['claude'],
      activeJobId: null,
      lastHeartbeatAt: 1,
      leaseExpiresAt: null,
    },
  ],
};

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('factory client', () => {
  it('sends the bearer token on reads', async () => {
    // Arrange
    let authorization: string | null = null;
    server.use(
      http.get(`${BASE_URL}/api/v1/cells`, ({ request }) => {
        authorization = request.headers.get('authorization');
        return HttpResponse.json(cellReply);
      }),
    );

    // Act
    await client().listCells();

    // Assert
    expect(authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('sends the bearer token on the transition write', async () => {
    // Arrange
    let authorization: string | null = null;
    server.use(
      http.post(
        `${BASE_URL}/api/v1/work-orders/order-1/transitions`,
        ({ request }) => {
          authorization = request.headers.get('authorization');
          return HttpResponse.json({ code: 200, order: null }, { status: 200 });
        },
      ),
    );

    // Act
    await captureError(() => client().transitionWorkOrder('order-1', 'resume'));

    // Assert
    expect(authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('fails when a reply misses a required field', async () => {
    // Arrange
    server.use(
      http.get(`${BASE_URL}/api/v1/cells`, () =>
        HttpResponse.json({ code: 200, cells: [{ name: 'alpha' }] }),
      ),
    );

    // Act
    const error = await captureError(() => client().listCells());

    // Assert
    expect(error.status).toBe(502);
  });

  it('throws FactoryUnavailable with the status when the server fails', async () => {
    // Arrange
    server.use(
      http.get(`${BASE_URL}/api/v1/cells`, () =>
        HttpResponse.json(
          { code: 500, type: 'internal-server-error', message: 'boom' },
          { status: 500 },
        ),
      ),
    );

    // Act
    const error = await captureError(() => client().listCells());

    // Assert
    expect(error).toBeInstanceOf(FactoryUnavailable);
    expect(error.status).toBe(500);
    expect(error.code).toBe('internal-server-error');
  });

  it('reports status 0 when the factory cannot be reached', async () => {
    // Arrange
    server.use(
      http.get(`${BASE_URL}/api/v1/cells`, () => HttpResponse.error()),
    );

    // Act
    const error = await captureError(() => client().listCells());

    // Assert
    expect(error.status).toBe(0);
  });

  it('sends exactly the action in the transition body', async () => {
    // Arrange
    let body: unknown = null;
    server.use(
      http.post(
        `${BASE_URL}/api/v1/work-orders/order-1/transitions`,
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ code: 200, order: null }, { status: 200 });
        },
      ),
    );

    // Act
    await captureError(() => client().transitionWorkOrder('order-1', 'resume'));

    // Assert
    expect(body).toEqual({ action: 'resume' });
  });

  it('keeps the token out of the error', async () => {
    // Arrange
    server.use(
      http.get(`${BASE_URL}/api/v1/cells`, () =>
        HttpResponse.json(
          { code: 401, type: 'unauthorized', message: 'bad token' },
          { status: 401 },
        ),
      ),
    );

    // Act
    const error = await captureError(() => client().listCells());

    // Assert
    expect(error.message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(error.code).toBe('unauthorized');
  });
});
