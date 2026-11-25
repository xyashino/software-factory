import { HQ_PROTOCOL_VERSION } from '@repo/hq-contracts/version.contract';
import { describe, expect, it } from 'vitest';
import { HQ_VERSION } from '../../src/version';
import { createTestApp } from '../support/test-app';

describe('version endpoint', () => {
  it('reports the build and protocol version without a token', async () => {
    const { app } = createTestApp();

    const response = await app.request('/api/v1/version');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      version: HQ_VERSION,
      protocolVersion: HQ_PROTOCOL_VERSION,
    });
  });
});
