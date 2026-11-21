import { describe, expect, it } from 'vitest';
import { createTestApp } from '../support/test-app';

type Endpoint = { method: 'GET' | 'POST' | 'DELETE'; path: string };

const ENDPOINTS: Endpoint[] = [
  { method: 'POST', path: '/api/v1/tokens' },
  { method: 'POST', path: '/api/v1/tokens/rotate' },
  { method: 'DELETE', path: '/api/v1/tokens/token-1' },
  { method: 'POST', path: '/api/v1/projects' },
  { method: 'GET', path: '/api/v1/projects' },
  { method: 'GET', path: '/api/v1/queue/export' },
  { method: 'POST', path: '/api/v1/queue/import' },
  { method: 'POST', path: '/api/v1/queue/actions' },
  { method: 'POST', path: '/api/v1/order-plans' },
  { method: 'GET', path: '/api/v1/order-plans' },
  { method: 'GET', path: '/api/v1/order-plans/plan-1' },
  { method: 'POST', path: '/api/v1/order-plans/plan-1/transitions' },
  { method: 'POST', path: '/api/v1/work-orders' },
  { method: 'GET', path: '/api/v1/work-orders' },
  { method: 'GET', path: '/api/v1/work-orders/order-1' },
  { method: 'POST', path: '/api/v1/work-orders/order-1/transitions' },
  { method: 'GET', path: '/api/v1/incidents' },
  { method: 'POST', path: '/api/v1/incidents/incident-1/resolve' },
  { method: 'POST', path: '/api/v1/cells/enroll' },
  { method: 'POST', path: '/api/v1/cells/hello' },
  { method: 'GET', path: '/api/v1/cells' },
  { method: 'DELETE', path: '/api/v1/cells/cell-1' },
  { method: 'POST', path: '/api/v1/cells/claims' },
  { method: 'POST', path: '/api/v1/cells/heartbeats' },
  { method: 'POST', path: '/api/v1/cells/cell-1/drain' },
  { method: 'POST', path: '/api/v1/cells/leave' },
  { method: 'POST', path: '/api/v1/jobs/job-1/transitions' },
  { method: 'GET', path: '/api/v1/stream' },
];

describe('route index', () => {
  it('lists all 28 endpoints of the plan', () => {
    expect(ENDPOINTS).toHaveLength(28);
  });

  it.each(ENDPOINTS)(
    'mounts $method $path behind bearer auth',
    async ({ method, path }) => {
      const { app } = createTestApp();

      const response = await app.request(path, { method });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: 401,
        type: 'unauthorized',
      });
    },
  );
});
