import { describe, expect, it } from 'vitest';
import { Refused, Unreachable } from '../../../../src/application/core/errors';
import { createCellServerAdapter } from '../../../../src/adapters/http/cell-server.adapter';

const BASE_URL = 'http://cell-server.test';

const fetchReplying = (reply: () => Response): typeof fetch =>
  (async () => reply()) as typeof fetch;

describe('cell server adapter', () => {
  it('returns the parsed body of a 200 reply', async () => {
    // Arrange
    const client = createCellServerAdapter({
      baseUrl: BASE_URL,
      fetchImpl: fetchReplying(() => Response.json({ cells: [] })),
    });

    // Act
    const value = await client.get('/api/v1/cells');

    // Assert
    expect(value).toEqual({ cells: [] });
  });

  it('refuses with the server error message on a 409 reply', async () => {
    // Arrange
    const client = createCellServerAdapter({
      baseUrl: BASE_URL,
      fetchImpl: fetchReplying(
        () =>
          new Response(
            JSON.stringify({
              code: 409,
              type: 'error',
              message: 'cell running',
            }),
            { status: 409 },
          ),
      ),
    });

    // Act
    const attempt = client.delete('/api/v1/cells/slot-1');

    // Assert
    await expect(attempt).rejects.toThrow(Refused);
    await expect(attempt).rejects.toThrow('409: cell running');
  });

  it('reports Unreachable when the connection fails', async () => {
    // Arrange
    const client = createCellServerAdapter({
      baseUrl: BASE_URL,
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });

    // Act
    const attempt = client.health();

    // Assert
    await expect(attempt).rejects.toThrow(Unreachable);
  });

  it('sends the JSON body on post', async () => {
    // Arrange
    const sent: { url: string; method: string | undefined; body: unknown }[] =
      [];
    const client = createCellServerAdapter({
      baseUrl: BASE_URL,
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        sent.push({
          url: String(url),
          method: init?.method,
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ code: 201, cells: [] }, { status: 201 });
      }) as typeof fetch,
    });

    // Act
    await client.post('/api/v1/cells', { repoRoot: '/repo', count: 2 });

    // Assert
    expect(sent).toEqual([
      {
        url: `${BASE_URL}/api/v1/cells`,
        method: 'POST',
        body: { repoRoot: '/repo', count: 2 },
      },
    ]);
  });
});
