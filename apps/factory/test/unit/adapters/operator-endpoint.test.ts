import { describe, expect, it } from 'vitest';
import { createOperatorEndpoint } from '../../../src/adapters/operator-endpoint/bun-endpoint';
import type { JobId } from '../../../src/domain/common/brand';

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('operator endpoint', () => {
  it('passes an agent verb to the handler and answers with its code', async () => {
    // Arrange
    const endpoint = createOperatorEndpoint();
    const { url } = await endpoint.open('job-1' as JobId, async (request) =>
      (request as { token: string }).token === 'secret'
        ? { code: 200 }
        : { code: 401, type: 'unauthorized' },
    );

    try {
      // Act
      const accepted = await post(url, { verb: 'done', token: 'secret' });
      const refused = await post(url, { verb: 'done', token: 'wrong' });

      // Assert
      expect(accepted.status).toBe(200);
      expect(refused.status).toBe(401);
    } finally {
      await endpoint.close();
    }
  });
});
