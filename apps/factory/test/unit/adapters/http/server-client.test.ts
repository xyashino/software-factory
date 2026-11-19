import { describe, expect, it } from 'vitest';
import { Refused, Unreachable } from '../../../../src/application/core/errors';
import { createServerClient } from '../../../../src/adapters/http/server-client';

const BASE_URL = 'http://factory.test';
const TOKEN = 'secret-token-value';

const countingFetch = (impl: () => Promise<Response>) => {
  const calls = { count: 0, headers: undefined as HeadersInit | undefined };
  const fetchImpl = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.count += 1;
    calls.headers = init?.headers;
    return impl();
  }) as typeof fetch;
  return { calls, fetchImpl };
};

describe('server client', () => {
  it('sends the bearer token and returns the parsed reply', async () => {
    // Arrange
    const { calls, fetchImpl } = countingFetch(async () =>
      Response.json({ done: true }),
    );
    const client = createServerClient({ baseUrl: BASE_URL, fetchImpl });

    // Act
    const value = await client.call('/api/v1/cells', {}, TOKEN);

    // Assert
    expect(value).toEqual({ done: true });
    expect(calls.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    });
  });

  it('reports Unreachable after one attempt when the network fails', async () => {
    // Arrange
    const { calls, fetchImpl } = countingFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const client = createServerClient({ baseUrl: BASE_URL, fetchImpl });

    // Act
    const attempt = client.call('/api/v1/cells', {}, TOKEN);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(Unreachable);
    expect(calls.count).toBe(1);
  });

  it('refuses with code and message when the server answers 401', async () => {
    // Arrange
    const { fetchImpl } = countingFetch(async () =>
      Response.json(
        { code: 401, type: 'unauthorized', message: 'Unauthorized' },
        { status: 401 },
      ),
    );
    const client = createServerClient({ baseUrl: BASE_URL, fetchImpl });

    // Act
    const attempt = client.call('/api/v1/cells', {}, TOKEN);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(Refused);
    await expect(attempt).rejects.toThrow('401: Unauthorized');
  });

  it('answers the probe with true for any HTTP status', async () => {
    // Arrange
    const { fetchImpl } = countingFetch(
      async () => new Response('not found', { status: 404 }),
    );
    const client = createServerClient({ baseUrl: BASE_URL, fetchImpl });

    // Act
    const answering = await client.probe();

    // Assert
    expect(answering).toBe(true);
  });

  it('answers the probe with false when nothing listens', async () => {
    // Arrange
    const { fetchImpl } = countingFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const client = createServerClient({ baseUrl: BASE_URL, fetchImpl });

    // Act
    const answering = await client.probe();

    // Assert
    expect(answering).toBe(false);
  });
});
