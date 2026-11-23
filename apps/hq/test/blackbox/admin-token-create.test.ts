import { describe, expect, it } from 'vitest';
import { mintAdminToken } from '../../src/bootstrap/admin';
import { getJson, createTestApp } from '../support/test-app';

describe('admin token create', () => {
  it('mints an operator token with the sf_op_ prefix', () => {
    const { db, clock } = createTestApp({ safeTokenAuth: true });

    const token = mintAdminToken(db, clock);

    expect(token.startsWith('sf_op_')).toBe(true);
  });

  it('mints a token that opens the operator read routes', async () => {
    const { app, db, clock } = createTestApp({ safeTokenAuth: true });
    const token = mintAdminToken(db, clock);

    const response = await getJson(app, '/api/v1/projects', {
      authorization: `Bearer ${token}`,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 200, projects: [] });
  });
});
