import { describe, expect, it } from 'vitest';
import { mintAdminToken } from '../../src/bootstrap/admin';
import { getJson, createTestApp } from '../support/test-app';

describe('admin token create', () => {
  it('mints a supervisor token with the sf_sup_ prefix', async () => {
    const { storage, clock } = createTestApp({ safeTokenAuth: true });

    const token = await mintAdminToken(storage, clock);

    expect(token.startsWith('sf_sup_')).toBe(true);
  });

  it('mints a token that opens the supervisor read routes', async () => {
    const { app, storage, clock } = createTestApp({ safeTokenAuth: true });
    const token = await mintAdminToken(storage, clock);

    const response = await getJson(app, '/api/v1/projects', {
      authorization: `Bearer ${token}`,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200, projects: [] });
  });
});
