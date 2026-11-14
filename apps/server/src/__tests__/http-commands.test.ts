import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, OrderId, ProjectId } from '@repo/factory-core/ids';
import { fakePrState } from '@repo/factory-core/testing';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { gitMirror } from '../adapters/git-mirror';
import { createHttpApp } from '../http/app';
import { createFixtureRepo, todoFile } from './e2e/fixture-repo';

/**
 * The supervisor command routes, intake sync and both heartbeat paths, over the Hono app with the real
 * git adapter: each one is answered from the same runtime the socket uses (PROTOCOL §3.1, §3.2).
 */

const PROJECT = 'software-factory' as ProjectId;
const ORDER = 'software-factory:add-login' as OrderId;
const CELL_NAME = 'cell-under-test';
/** A well-formed question id (a ULID) that no station ever asked. */
const UNASKED_QUESTION = '01J0000000000000000000000Q';

let root: string;
let opened: OpenedRuntime;
let app: ReturnType<typeof createHttpApp>;
let commandSeq = 0;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-http-commands-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const repo = await createFixtureRepo(join(root, 'repo'), {
    'add-login': todoFile({ title: 'Add login', v2: true }),
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

const supervisorToken = async (): Promise<string> =>
  (await opened.runtime.remote.createSupervisorToken('dev')).token;

/** A fresh command id, one per call, the way the CLI sends one per invocation. */
const nextCommandId = (): string => `cmd-http-${(commandSeq += 1)}`;

/** Syncs intake over HTTP so the fixture order exists on the board. */
const syncIntake = async (token: string): Promise<void> => {
  const response = await send({
    method: 'POST',
    path: '/v1/intake/sync',
    token,
    json: {},
  });
  expect(response.status).toBe(200);
};

/** Joins a Cell over HTTP, greets as it, and returns its identity. */
const joinAndHello = async (): Promise<{
  cellId: CellId;
  credential: string;
}> => {
  const created = await opened.runtime.call('joinTokenCreate', {
    commandId: nextCommandId(),
    name: 'pool',
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
      slots: 1,
    },
  });
  expect(hello.status).toBe(200);
  return { cellId, credential };
};

/** Claims the fixture order's first station for the Cell over HTTP. */
const claimJob = async (cell: {
  cellId: CellId;
  credential: string;
}): Promise<Job> => {
  const response = await send({
    method: 'POST',
    path: '/v1/cell/claim',
    token: cell.credential,
    json: { cellId: cell.cellId, waitMs: 0 },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { job: Job | null };
  if (!body.job) throw new Error('expected a job on offer');
  return body.job;
};

/** One heartbeat that holds the given jobs and acks the given signals. */
const beat = async (
  cell: { cellId: CellId; credential: string },
  jobs: string[],
  acked: string[] = [],
) => {
  const response = await send({
    method: 'POST',
    path: '/v1/cell/heartbeat',
    token: cell.credential,
    json: { cellId: cell.cellId, jobs, acked },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    jobs: { jobId: string; status: 'ok' | 'stale' }[];
    signals: { signalId: string; jobId: string; kind: string; text?: string }[];
  };
};

/** A commit the Cell names as the base of its Cycle; the fixture needs no real history for it. */
const BASE_COMMIT = 'a'.repeat(40);

/**
 * The Cell starts the Cycle of its job over HTTP (the Cell's own command). A nudge needs a running
 * Cycle, so the supervisor tests start one first, the way a Cell does.
 */
const startCycle = async (
  cell: { cellId: CellId; credential: string },
  job: Job,
): Promise<void> => {
  const response = await send({
    method: 'POST',
    path: `/v1/cell/jobs/${job.jobId}/commands`,
    token: cell.credential,
    json: {
      commandId: nextCommandId(),
      epoch: job.epoch,
      command: { type: 'StartCycle', baseCommit: BASE_COMMIT },
    },
  });
  expect(response.status).toBe(200);
};

/** A supervisor command over HTTP, with a fresh commandId. */
const command = (
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  send({
    method: 'POST',
    path,
    token,
    json: { commandId: nextCommandId(), ...body },
  });

const orderPath = (suffix: string): string =>
  `/v1/orders/${encodeURIComponent(ORDER)}${suffix}`;

describe('intake sync over HTTP', () => {
  it('registers the repository todo as a Work order on the board', async () => {
    const token = await supervisorToken();

    const sync = await send({
      method: 'POST',
      path: '/v1/intake/sync',
      token,
      json: {},
    });
    const board = await send({ path: '/v1/board', token });

    expect(sync.status).toBe(200);
    const body = (await board.json()) as { orders: { orderId: string }[] };
    expect(body.orders.map((row) => row.orderId)).toContain(ORDER);
  });
});

describe('the heartbeat over HTTP', () => {
  it('reports a job the Cell holds as ok while its lease is live', async () => {
    const token = await supervisorToken();
    await syncIntake(token);
    const cell = await joinAndHello();
    const job = await claimJob(cell);

    const answer = await beat(cell, [job.jobId]);

    expect(answer.jobs).toEqual([{ jobId: job.jobId, status: 'ok' }]);
    expect(answer.signals).toEqual([]);
  });

  it('delivers a nudge as a signal on the next beat, and acks it once', async () => {
    const token = await supervisorToken();
    await syncIntake(token);
    const cell = await joinAndHello();
    const job = await claimJob(cell);
    await startCycle(cell, job);

    const nudge = await command(token, orderPath('/nudge'), {
      text: 'look at the todo again',
    });
    const delivered = await beat(cell, [job.jobId]);
    const acked = await beat(
      cell,
      [job.jobId],
      delivered.signals.map((signal) => signal.signalId),
    );

    expect(nudge.status).toBe(200);
    expect(delivered.signals).toEqual([
      expect.objectContaining({
        jobId: job.jobId,
        kind: 'nudge',
        text: 'look at the todo again',
      }),
    ]);
    expect(acked.signals).toEqual([]);
  });

  it('reports a job the supervisor cancelled as stale on the next beat', async () => {
    const token = await supervisorToken();
    await syncIntake(token);
    const cell = await joinAndHello();
    const job = await claimJob(cell);

    const cancel = await command(token, orderPath('/cancel'), {
      reason: 'no longer wanted',
    });
    const after = await beat(cell, [job.jobId]);

    expect(cancel.status).toBe(200);
    expect(after.jobs).toEqual([{ jobId: job.jobId, status: 'stale' }]);
  });
});

describe('supervisor command routes over HTTP', () => {
  it('changes the priority and answers with the command result', async () => {
    const token = await supervisorToken();
    await syncIntake(token);

    const response = await command(token, orderPath('/priority'), {
      priority: 'low',
    });
    const board = await send({ path: '/v1/board', token });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dryRun: false });
    const body = (await board.json()) as {
      orders: { orderId: string; priority: string }[];
    };
    expect(body.orders.find((row) => row.orderId === ORDER)?.priority).toBe(
      'low',
    );
  });

  it('refuses an answer to a question that was never asked with 404', async () => {
    const token = await supervisorToken();
    await syncIntake(token);

    const response = await command(token, orderPath('/answer'), {
      questionId: UNASKED_QUESTION,
      text: 'an answer',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'not_found' });
  });

  it('refuses a resume or a reopen of an order with no stopped station', async () => {
    const token = await supervisorToken();
    await syncIntake(token);

    const resume = await command(token, orderPath('/resume'), {
      mode: { kind: 'retry_station' },
    });
    const reopen = await command(token, orderPath('/reopen'), {
      stationId: 'plan',
    });

    expect(resume.status).toBe(409);
    expect(reopen.status).toBe(409);
  });

  it('refuses a command on an order that does not exist with 404', async () => {
    const token = await supervisorToken();

    const response = await command(
      token,
      `/v1/orders/${encodeURIComponent('software-factory:nope')}/cancel`,
      { reason: 'gone' },
    );

    expect(response.status).toBe(404);
  });

  it('refuses a Cell credential on every supervisor command route', async () => {
    await syncIntake(await supervisorToken());
    const cell = await joinAndHello();

    const responses = await Promise.all([
      command(cell.credential, orderPath('/priority'), { priority: 'low' }),
      command(cell.credential, orderPath('/nudge'), { text: 'x' }),
      command(cell.credential, orderPath('/cancel'), { reason: 'x' }),
      command(cell.credential, orderPath('/answer'), {
        questionId: 'q',
        text: 'x',
      }),
      command(cell.credential, orderPath('/resume'), {
        mode: { kind: 'retry_station' },
      }),
      command(cell.credential, orderPath('/reopen'), { stationId: 'plan' }),
      send({
        method: 'POST',
        path: '/v1/intake/sync',
        token: cell.credential,
        json: {},
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      401, 401, 401, 401, 401, 401, 401,
    ]);
  });
});
