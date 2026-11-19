import { describe, expect, it } from 'vitest';
import { Refused } from '../../../../src/application/core/errors';
import { createServerClient } from '../../../../src/adapters/http/server-client';

const BASE_URL = 'http://factory.test';
const TOKEN = 'secret-token-value';

describe('server client get', () => {
  it('sends the query string and bearer token', async () => {
    // Arrange
    const seen: { url: string; headers: HeadersInit | undefined }[] = [];
    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      seen.push({ url: String(url), headers: init?.headers });
      return Response.json({ items: [] });
    }) as typeof fetch;
    const client = createServerClient({ baseUrl: BASE_URL, fetchImpl });

    // Act
    await client.get(
      '/api/v1/work-orders',
      { projectId: 'software-factory', state: 'queued' },
      TOKEN,
    );

    // Assert
    expect(seen[0]?.url).toBe(
      `${BASE_URL}/api/v1/work-orders?projectId=software-factory&state=queued`,
    );
    expect(seen[0]?.headers).toEqual({ authorization: `Bearer ${TOKEN}` });
  });

  it('keeps the batch body on a 422 refusal', async () => {
    // Arrange
    const body = {
      code: 422,
      type: 'unprocessable-entity',
      message: 'invalid batch',
      errors: [{ filename: 'cli-05.md', message: 'slug conflict' }],
    };
    const fetchImpl = (async () =>
      Response.json(body, { status: 422 })) as typeof fetch;
    const client = createServerClient({ baseUrl: BASE_URL, fetchImpl });

    // Act
    const attempt = client.call('/api/v1/queue/import', {}, TOKEN);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(Refused);
    await expect(attempt).rejects.toMatchObject({ details: body });
  });
});
