import { afterEach, describe, expect, it } from 'vitest';
import {
  PROJECT_ID,
  bearer,
  callFactory,
  callLocal,
  cellEnvOf,
  createHarness,
  readJson,
  scaleTo,
  type Harness,
} from './support/harness';

interface ScaleStatus {
  projects: { projectId: string; desired: number; running: number }[];
}

interface ClaimedJob {
  code: number;
  job: { jobId: string; epoch: number; orderId: string | null } | null;
}

interface OrderList {
  items: {
    orderId: string;
    state: string;
    epoch: number;
    activeJobId: string | null;
  }[];
}

const CLAIM_BODY = {
  projectId: PROJECT_ID,
  allowedLines: ['feature'],
  runners: ['claude'],
};
const LINE_SNAPSHOT = {
  name: 'feature',
  stations: [
    {
      id: 'build',
      kind: 'operator',
      requiredFiles: ['report.md'],
      maxAttempts: 2,
    },
    { id: 'deliver', kind: 'deliver', requiredFiles: [], maxAttempts: 1 },
  ],
};

const harnesses: Harness[] = [];

const standalone = (): Harness => {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
};

const queueFeature = async (harness: Harness, slug: string): Promise<void> => {
  const response = await callLocal(harness, 'POST', '/api/v1/work-orders', {
    projectId: PROJECT_ID,
    slug,
    title: `Task ${slug}`,
    type: 'feat',
    lineName: 'feature',
  });
  expect(response.status).toBe(201);
};

const claimAs = async (
  harness: Harness,
  cellIndex = 0,
): Promise<ClaimedJob> => {
  const { token } = cellEnvOf(harness, cellIndex);
  const response = await callFactory(
    harness,
    'POST',
    '/relay/api/v1/cells/claims',
    CLAIM_BODY,
    bearer(token),
  );
  expect(response.status).toBe(200);
  return readJson<ClaimedJob>(response);
};

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    void harness.app.stop();
  }
});

describe('standalone factory', () => {
  it('scales a Cell when the factory is not connected', async () => {
    const harness = standalone();

    const scaled = await scaleTo(harness, 1);
    const scaledBody = await readJson(scaled);
    const status = await readJson<ScaleStatus>(
      await callFactory(harness, 'GET', '/scale'),
    );

    expect(scaledBody).toEqual({ projectId: PROJECT_ID });
    expect(harness.spawned).toHaveLength(1);
    expect(status.projects).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID,
        desired: 1,
        running: 1,
      }),
    ]);
  });

  it('claims a queued job for the scaled project through the relay', async () => {
    const harness = standalone();
    await scaleTo(harness, 1);
    await queueFeature(harness, 'first');

    const claimed = await claimAs(harness);

    expect(claimed.code).toBe(200);
    expect(claimed.job).toEqual(
      expect.objectContaining({ orderId: `${PROJECT_ID}:first` }),
    );
  });

  it('starts a claimed job through the relay transitions route', async () => {
    const harness = standalone();
    await scaleTo(harness, 1);
    await queueFeature(harness, 'start-me');
    const claimed = await claimAs(harness);
    const jobId = claimed.job?.jobId ?? '';
    const { token } = cellEnvOf(harness);

    const response = await callFactory(
      harness,
      'POST',
      `/relay/api/v1/jobs/${jobId}/transitions`,
      {
        action: 'start',
        commandId: 'cmd-start',
        epoch: claimed.job?.epoch,
        lineSnapshot: LINE_SNAPSHOT,
      },
      bearer(token),
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      code: 200,
      action: 'start',
      status: 'running',
    });
  });

  it('answers an incident resolve with the local engine verdict', async () => {
    const harness = standalone();
    await scaleTo(harness, 1);
    const { token } = cellEnvOf(harness);

    const response = await callFactory(
      harness,
      'POST',
      '/relay/api/v1/incidents/inc-missing/resolve',
      { action: 'retry_step', stepIndex: 0, epoch: 1 },
      bearer(token),
    );

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({
      code: 404,
      type: 'not-found',
      message: 'Incident inc-missing not found',
    });
  });

  it('requeues the claimed job and bumps its epoch when the Cell is scaled down', async () => {
    const harness = standalone();
    await scaleTo(harness, 1);
    await queueFeature(harness, 'orphan');
    const claimed = await claimAs(harness);

    const scaledDown = await scaleTo(harness, 0);
    const list = await readJson<OrderList>(
      await callLocal(
        harness,
        'GET',
        `/api/v1/work-orders?projectId=${PROJECT_ID}`,
      ),
    );

    expect(scaledDown.status).toBe(200);
    expect(list.items).toEqual([
      expect.objectContaining({
        orderId: `${PROJECT_ID}:orphan`,
        state: 'queued',
        activeJobId: null,
      }),
    ]);
    expect(list.items[0]?.epoch).toBeGreaterThan(claimed.job?.epoch ?? 0);
  });

  it('refuses direct api calls that carry no local token', async () => {
    const harness = standalone();

    const response = await callFactory(harness, 'GET', '/api/v1/projects');

    expect(response.status).toBe(401);
  });

  it('refuses a relay call that carries no known cell token', async () => {
    const harness = standalone();

    const response = await callFactory(
      harness,
      'POST',
      '/relay/api/v1/cells/claims',
      CLAIM_BODY,
      bearer('unknown-token'),
    );

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({
      code: 401,
      type: 'unauthorized',
      message: 'unknown or expired cell token',
    });
  });

  it('keeps forbidden relay routes refused', async () => {
    const harness = standalone();
    await scaleTo(harness, 1);
    const { token } = cellEnvOf(harness);

    const response = await callFactory(
      harness,
      'POST',
      '/relay/api/v1/tokens',
      {},
      bearer(token),
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      code: 403,
      type: 'forbidden',
      message: 'route POST /api/v1/tokens is not relayed',
    });
  });
});
