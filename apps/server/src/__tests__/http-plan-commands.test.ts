import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, ProjectId } from '@repo/factory-core/ids';
import { fakePrState } from '@repo/factory-core/testing';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { gitMirror } from '../adapters/git-mirror';
import { createHttpApp } from '../http/app';
import { createFixtureRepo } from './e2e/fixture-repo';

/**
 * A Cell's plan commands over HTTP (PROTOCOL §3.2, §4): the plan variant of `submitCommand` is routed by the
 * lease of its job, so a plan job's report reaches its plan stream and a Work order's still reaches its order.
 */

const PROJECT = 'software-factory' as ProjectId;
const PLAN_TODO = [
  '---',
  'status: todo',
  'factory: v2',
  'plan: xyz',
  'priority: high',
  '---',
  '',
  '# Plan root',
  '',
  'Users can sign in.',
  '',
].join('\n');
const CELL_NAME = 'plan-cell';
const COMMIT = 'e'.repeat(40);

let root: string;
let opened: OpenedRuntime;
let app: ReturnType<typeof createHttpApp>;
let commandSeq = 0;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-http-plan-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const repo = await createFixtureRepo(join(root, 'repo'), {
    'wo-1': PLAN_TODO,
  });
  seedProject(dataDir, { projectId: PROJECT, repoUrl: repo });
  opened = openRuntime({
    dataDir,
    git: gitMirror({ mirrorsDir: join(dataDir, 'mirrors') }),
    prState: fakePrState(),
    config: { intakePollMs: 0, prPollMs: 0 },
  });
  await opened.runtime.start();
  app = createHttpApp(opened.runtime);
});

afterEach(() => {
  opened.close();
  rmSync(root, { recursive: true, force: true });
});

interface Sent {
  method?: string;
  path: string;
  token?: string;
  json?: unknown;
}

const send = async (sent: Sent): Promise<Response> => {
  const headers: Record<string, string> = {};
  if (sent.token) headers.authorization = `Bearer ${sent.token}`;
  let body: BodyInit | undefined;
  if (sent.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(sent.json);
  }
  return await app.request(sent.path, {
    method: sent.method ?? 'GET',
    headers,
    body,
  });
};

const nextCommandId = (): string => {
  commandSeq += 1;
  return `plan-http-${commandSeq}`;
};

/** Joins a Cell with a fresh token and sends its hello; returns its id and credential. */
const joinAndHello = async (): Promise<{
  cellId: CellId;
  credential: string;
}> => {
  const created = await opened.runtime.call('joinTokenCreate', {
    commandId: nextCommandId(),
    name: CELL_NAME,
  });
  const joined = await send({
    method: 'POST',
    path: '/v1/cell/join',
    json: { joinToken: created.token, name: CELL_NAME },
  });
  expect(joined.status).toBe(200);
  const { cellId, credential } = (await joined.json()) as {
    cellId: CellId;
    credential: string;
  };
  const hello = await send({
    method: 'POST',
    path: '/v1/cell/hello',
    token: credential,
    json: {
      cellId,
      version: '0.1.0',
      projects: [PROJECT],
      runners: ['claude'],
      capabilities: [],
    },
  });
  expect(hello.status).toBe(200);
  return { cellId, credential };
};

const supervisorToken = async (): Promise<string> =>
  (await opened.runtime.remote.createSupervisorToken('dev')).token;

/** Syncs intake and claims the first job on offer for the Cell over HTTP. */
const syncAndClaim = async (cell: {
  cellId: CellId;
  credential: string;
}): Promise<Job> => {
  const sync = await send({
    method: 'POST',
    path: '/v1/intake/sync',
    token: await supervisorToken(),
    json: {},
  });
  expect(sync.status).toBe(200);
  const response = await send({
    method: 'POST',
    path: '/v1/cell/claim',
    token: cell.credential,
    json: { cellId: cell.cellId, waitMs: 0 },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { job: Job | null };
  if (!body.job) throw new Error('expected a plan job on offer');
  return body.job;
};

const reportPath = (job: Job): string => `/v1/cell/jobs/${job.jobId}/commands`;

describe('a Cell reports a plan job over HTTP', () => {
  it('claims plan_branch, then reports ReportPlanBranch on the plan stream', async () => {
    const cell = await joinAndHello();
    const job = await syncAndClaim(cell);
    expect(job).toMatchObject({
      kind: 'plan_branch',
      orderId: 'software-factory:plan:xyz',
    });

    const response = await send({
      method: 'POST',
      path: reportPath(job),
      token: cell.credential,
      json: {
        planId: job.orderId,
        commandId: nextCommandId(),
        epoch: job.epoch,
        command: { type: 'ReportPlanBranch', commit: COMMIT },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      dryRun: false,
      events: [{ type: 'plan_branch_created', commit: COMMIT }],
      next: null,
    });
  });

  it('refuses a plan report under a stale epoch with 409 stale_epoch', async () => {
    const cell = await joinAndHello();
    const job = await syncAndClaim(cell);

    const late = await send({
      method: 'POST',
      path: reportPath(job),
      token: cell.credential,
      json: {
        planId: job.orderId,
        commandId: nextCommandId(),
        epoch: job.epoch + 1,
        command: { type: 'ReportPlanBranch', commit: COMMIT },
      },
    });

    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ code: 'stale_epoch' });
  });

  it('refuses a plan command sent under an orderId', async () => {
    const cell = await joinAndHello();
    const job = await syncAndClaim(cell);

    const wrong = await send({
      method: 'POST',
      path: reportPath(job),
      token: cell.credential,
      json: {
        orderId: job.orderId,
        commandId: nextCommandId(),
        epoch: job.epoch,
        command: { type: 'ReportPlanBranch', commit: COMMIT },
      },
    });

    expect(wrong.status).not.toBe(200);
  });
});
