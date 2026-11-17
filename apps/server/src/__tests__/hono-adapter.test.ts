import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@repo/factory-core/ids';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { createHttpApp } from '../http/app';

const PROJECT = 'software-factory' as ProjectId;
const MISSING_BLOB = `sha256:${'0'.repeat(64)}`;

let dataDir: string;
let opened: OpenedRuntime;
let app: ReturnType<typeof createHttpApp>;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-adapter-'));
  seedProject(dataDir, {
    projectId: PROJECT,
    repoUrl: 'https://example.test/software-factory.git',
  });
  opened = openRuntime({ dataDir });
  await opened.runtime.start();
  app = createHttpApp(opened.runtime);
});

afterEach(() => {
  opened.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const supervisorToken = async (): Promise<string> =>
  (await opened.runtime.remote.createSupervisorToken('dev')).token;

describe('HTTP adapter', () => {
  it('answers an unknown path with not_found', async () => {
    const response = await app.request('/v1/no-such-route');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'not_found' });
  });

  it('refuses a body that is not JSON as invalid', async () => {
    const response = await app.request('/v1/orders', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await supervisorToken()}`,
        'content-type': 'application/json',
      },
      body: '{not json',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'invalid' });
  });

  it('refuses a JSON body that is not an object as invalid', async () => {
    const response = await app.request('/v1/orders', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await supervisorToken()}`,
        'content-type': 'application/json',
      },
      body: '[1, 2]',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: 'invalid',
      issues: ['(body): the body is not an object'],
    });
  });

  it('refuses a bearer route sent without a credential as unauthorized', async () => {
    const response = await app.request('/v1/board');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'unauthorized' });
  });

  it('answers a blob that does not exist with not_found', async () => {
    const response = await app.request(
      `/v1/blobs/${encodeURIComponent(MISSING_BLOB)}`,
      { headers: { authorization: `Bearer ${await supervisorToken()}` } },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'not_found' });
  });

  it('refuses a stream cursor that is not a whole number as invalid', async () => {
    const response = await app.request('/v1/stream?after=later', {
      headers: { authorization: `Bearer ${await supervisorToken()}` },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'invalid' });
  });
});
