import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HTTP_ROUTES } from '@repo/factory-core/contracts/http-routes';
import type { ProjectId } from '@repo/factory-core/ids';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { adminProcedures } from '../application/procedures/admin.procedures';
import { blobProcedures } from '../application/procedures/blobs.procedures';
import { cellProcedures } from '../application/procedures/cells.procedures';
import { orderProcedures } from '../application/procedures/orders.procedures';
import { planProcedures } from '../application/procedures/plans.procedures';
import { projectProcedures } from '../application/procedures/projects.procedures';
import { githubWebhookProcedure } from '../application/procedures/webhooks.procedures';
import { createHttpApp } from '../http/app';

const PROJECT = 'software-factory' as ProjectId;

/** Routes served by the SSE module rather than a procedure: the event feed. */
const STREAM = 'stream';

const domainRoutes = [
  ...adminProcedures,
  ...blobProcedures,
  ...cellProcedures,
  ...orderProcedures,
  ...planProcedures,
  ...projectProcedures,
  githubWebhookProcedure(undefined),
].map((procedure) => procedure.name);

describe('route registry', () => {
  it('registers each HTTP route in exactly one domain module', () => {
    const expected = Object.keys(HTTP_ROUTES)
      .filter((name) => name !== STREAM)
      .sort();

    expect([...domainRoutes].sort()).toEqual(expected);
  });
});

describe('served routes', () => {
  let dataDir: string;
  let opened: OpenedRuntime;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'factory-registry-'));
    seedProject(dataDir, {
      projectId: PROJECT,
      repoUrl: 'https://example.test/software-factory.git',
    });
    opened = openRuntime({ dataDir });
    await opened.runtime.start();
  });

  afterEach(() => {
    opened.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('answers every route of the table, so none falls through to not_found', async () => {
    const app = createHttpApp(opened.runtime);

    for (const [name, spec] of Object.entries(HTTP_ROUTES)) {
      const path = spec.path.replace(/:[A-Za-z]+/g, 'probe');
      const hasBody = spec.method === 'POST';
      const response = await app.request(path, {
        method: spec.method,
        headers: hasBody ? { 'content-type': 'application/json' } : {},
        body: hasBody ? '{}' : undefined,
      });
      const answer: unknown = await response.json().catch(() => undefined);
      expect(answer, name).not.toMatchObject({ code: 'not_found' });
    }
  });
});
