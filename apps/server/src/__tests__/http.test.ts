import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BlobRef, ProjectId } from '@repo/factory-core/ids';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { createHttpApp } from '../http/app';

const PROJECT = 'software-factory' as ProjectId;
const CELL_NAME = 'cell-under-test';

let dataDir: string;
let opened: OpenedRuntime;
let app: ReturnType<typeof createHttpApp>;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-http-'));
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

interface Sent {
  method?: string;
  path: string;
  token?: string;
  json?: unknown;
  text?: string;
  raw?: Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
}

/** One request through the Hono app, the way the TCP listener delivers it. */
const send = async (sent: Sent): Promise<Response> => {
  const headers: Record<string, string> = { ...sent.headers };
  if (sent.token) headers.authorization = `Bearer ${sent.token}`;
  let body: BodyInit | undefined;
  if (sent.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(sent.json);
  } else if (sent.text !== undefined) {
    headers['content-type'] = 'application/json';
    body = sent.text;
  } else if (sent.raw !== undefined) {
    headers['content-type'] = sent.contentType ?? 'application/octet-stream';
    body = sent.raw as BodyInit;
  }
  return await app.request(sent.path, {
    method: sent.method ?? 'GET',
    headers,
    body,
  });
};

const supervisorToken = async (name = 'dev'): Promise<string> =>
  (await opened.runtime.remote.createSupervisorToken(name)).token;

const joinTokenValue = async (
  name = 'pool',
): Promise<{
  joinTokenId: string;
  token: string;
}> => {
  const created = await opened.runtime.call('joinTokenCreate', {
    commandId: `cmd-${name}-${Math.random()}`,
    name,
  });
  return { joinTokenId: created.joinTokenId, token: created.token };
};

/** Joins a Cell over HTTP and returns its identity, the way a Cell does on first start. */
const joinCell = async (): Promise<{ cellId: string; credential: string }> => {
  const { token } = await joinTokenValue();
  const response = await send({
    method: 'POST',
    path: '/v1/cell/join',
    json: { joinToken: token, name: CELL_NAME },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { cellId: string; credential: string };
};

const bodyOf = async (response: Response): Promise<unknown> =>
  (await response.json()) as unknown;

describe('supervisor routes', () => {
  it('answers the board to a supervisor token', async () => {
    const token = await supervisorToken();

    const response = await send({ path: '/v1/board', token });

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ orders: [] });
  });

  it('refuses a board read with no token as unauthorized', async () => {
    const response = await send({ path: '/v1/board' });

    expect(response.status).toBe(401);
    expect(await bodyOf(response)).toEqual({ code: 'unauthorized' });
  });

  it('refuses a malformed or unknown bearer as unauthorized', async () => {
    const malformed = await send({
      path: '/v1/board',
      headers: { authorization: 'Basic abc' },
    });
    const unknown = await send({ path: '/v1/board', token: 'not-issued-here' });

    expect(malformed.status).toBe(401);
    expect(unknown.status).toBe(401);
  });

  it('refuses a Cell credential on a supervisor route', async () => {
    const cell = await joinCell();

    const response = await send({ path: '/v1/cells', token: cell.credential });

    expect(response.status).toBe(401);
  });

  it('refuses a revoked Cell at its next call', async () => {
    const cell = await joinCell();
    const supervisor = await supervisorToken();
    await send({
      method: 'DELETE',
      path: `/v1/cells/${cell.cellId}`,
      token: supervisor,
    });

    const response = await send({
      method: 'POST',
      path: '/v1/cell/hello',
      token: cell.credential,
      json: helloBody(cell.cellId),
    });

    expect(response.status).toBe(401);
  });

  it('answers the export archive to a supervisor and refuses a Cell', async () => {
    const supervisor = await supervisorToken();
    const cell = await joinCell();

    const allowed = await send({ path: '/v1/admin/export', token: supervisor });
    const refused = await send({
      path: '/v1/admin/export',
      token: cell.credential,
    });

    expect(allowed.status).toBe(200);
    expect(await bodyOf(allowed)).toMatchObject({ bytes: expect.any(Number) });
    expect(refused.status).toBe(401);
  });

  it('answers a body that is not JSON with 422 invalid', async () => {
    const token = await supervisorToken();

    const response = await send({
      method: 'POST',
      path: '/v1/intake/sync',
      token,
      text: '{not json',
    });

    expect(response.status).toBe(422);
    expect(await bodyOf(response)).toEqual({
      code: 'invalid',
      issues: ['(body): the body is not JSON'],
    });
  });

  it('answers a body that fails its schema with 422 invalid', async () => {
    const token = await supervisorToken();

    const response = await send({
      method: 'POST',
      path: '/v1/orders/software-factory%3Atodo-1/answer',
      token,
      json: { commandId: 'cmd-1' },
    });

    expect(response.status).toBe(422);
    const body = (await bodyOf(response)) as { code: string };
    expect(body.code).toBe('invalid');
  });

  it('answers a missing Work order with 404 not_found', async () => {
    const token = await supervisorToken();

    const response = await send({
      path: '/v1/orders/software-factory%3Anope',
      token,
    });

    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toEqual({ code: 'not_found' });
  });
});

describe('join and Cell routes', () => {
  it('joins a Cell with a live join token and returns a credential', async () => {
    const { token } = await joinTokenValue();

    const response = await send({
      method: 'POST',
      path: '/v1/cell/join',
      json: { joinToken: token, name: CELL_NAME },
    });

    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as {
      cellId: string;
      credential: string;
    };
    expect(body.cellId).toMatch(/^[0-9A-Z]{26}$/);
    expect(body.credential.length).toBeGreaterThanOrEqual(32);
  });

  it('refuses a join with an unknown join token as unauthorized', async () => {
    const response = await send({
      method: 'POST',
      path: '/v1/cell/join',
      json: { joinToken: 'a'.repeat(43), name: CELL_NAME },
    });

    expect(response.status).toBe(401);
  });

  it('refuses a join with a revoked join token', async () => {
    const { joinTokenId, token } = await joinTokenValue('revoked');
    await opened.runtime.call('joinTokenRevoke', {
      joinTokenId,
    });

    const response = await send({
      method: 'POST',
      path: '/v1/cell/join',
      json: { joinToken: token, name: CELL_NAME },
    });

    expect(response.status).toBe(401);
  });

  it('refuses a join token used as a bearer on a Cell route', async () => {
    const { token } = await joinTokenValue('bearer');

    const response = await send({
      method: 'POST',
      path: '/v1/cell/claim',
      token,
      json: { cellId: '01J0000000000000000000000W', waitMs: 0 },
    });

    expect(response.status).toBe(401);
  });

  it('refuses a supervisor token on a Cell route', async () => {
    const supervisor = await supervisorToken();

    const response = await send({
      method: 'POST',
      path: '/v1/cell/claim',
      token: supervisor,
      json: { cellId: '01J0000000000000000000000W', waitMs: 0 },
    });

    expect(response.status).toBe(401);
  });

  it('greets as the Cell its credential names, and refuses a body naming another', async () => {
    const cell = await joinCell();

    const other = await send({
      method: 'POST',
      path: '/v1/cell/hello',
      token: cell.credential,
      json: helloBody('01J0000000000000000000000Z'),
    });
    const own = await send({
      method: 'POST',
      path: '/v1/cell/hello',
      token: cell.credential,
      json: helloBody(cell.cellId),
    });

    expect(other.status).toBe(422);
    expect(await bodyOf(other)).toEqual({
      code: 'invalid',
      issues: ['cellId: does not match the credential'],
    });
    expect(own.status).toBe(200);
    expect(await bodyOf(own)).toMatchObject({
      cellId: cell.cellId,
      config: { leaseTtlMs: expect.any(Number) },
    });
  });

  it('answers an empty claim with 204 and no body', async () => {
    const cell = await joinCell();
    await send({
      method: 'POST',
      path: '/v1/cell/hello',
      token: cell.credential,
      json: helloBody(cell.cellId),
    });

    const response = await send({
      method: 'POST',
      path: '/v1/cell/claim',
      token: cell.credential,
      json: { cellId: cell.cellId, waitMs: 0 },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('answers a heartbeat with per-job status and the pending signals', async () => {
    const cell = await joinCell();
    await send({
      method: 'POST',
      path: '/v1/cell/hello',
      token: cell.credential,
      json: helloBody(cell.cellId),
    });

    const response = await send({
      method: 'POST',
      path: '/v1/cell/heartbeat',
      token: cell.credential,
      json: {
        cellId: cell.cellId,
        jobs: ['01J0000000000000000000000J'],
        acked: [],
      },
    });

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({
      jobs: [{ jobId: '01J0000000000000000000000J', status: 'stale' }],
      signals: [],
    });
  });

  it('lists the joined Cell to a supervisor', async () => {
    const cell = await joinCell();
    const supervisor = await supervisorToken();

    const response = await send({ path: '/v1/cells', token: supervisor });

    expect(response.status).toBe(200);
    const body = (await bodyOf(response)) as { cells: { cellId: string }[] };
    expect(body.cells.map((row) => row.cellId)).toContain(cell.cellId);
  });

  it('stores a blob from a Cell as raw bytes and serves it back to a supervisor', async () => {
    const cell = await joinCell();
    const supervisor = await supervisorToken();
    const bytes = new TextEncoder().encode('# plan\n');
    const ref = blobRef(bytes);

    const put = await send({
      method: 'PUT',
      path: `/v1/blobs/${encodeURIComponent(ref)}`,
      token: cell.credential,
      raw: bytes,
      contentType: 'text/markdown',
    });
    const got = await send({
      path: `/v1/blobs/${encodeURIComponent(ref)}`,
      token: supervisor,
    });

    expect(put.status).toBe(200);
    expect(await bodyOf(put)).toEqual({ ref });
    expect(got.status).toBe(200);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
  });

  it('refuses a blob whose bytes do not match its ref', async () => {
    const cell = await joinCell();
    const ref = blobRef(new TextEncoder().encode('expected'));

    const put = await send({
      method: 'PUT',
      path: `/v1/blobs/${encodeURIComponent(ref)}`,
      token: cell.credential,
      raw: new TextEncoder().encode('other bytes'),
    });

    expect(put.status).toBe(422);
  });

  it('answers a missing blob with 404 not_found', async () => {
    const supervisor = await supervisorToken();
    const ref = blobRef(new TextEncoder().encode('never stored'));

    const response = await send({
      path: `/v1/blobs/${encodeURIComponent(ref)}`,
      token: supervisor,
    });

    expect(response.status).toBe(404);
  });
});

describe('routes that must not exist over HTTP', () => {
  it('answers the socket paths with 404', async () => {
    const token = await supervisorToken();

    const socketPath = await send({
      method: 'POST',
      path: '/v1/supervisor/board',
      token,
      json: {},
    });

    expect(socketPath.status).toBe(404);
    expect(await bodyOf(socketPath)).toEqual({ code: 'not_found' });
  });

  it('has no route that imports an archive', async () => {
    const token = await supervisorToken();

    const response = await send({
      method: 'POST',
      path: '/v1/admin/import',
      token,
      json: { file: '/tmp/anything.tar' },
    });

    expect(response.status).toBe(404);
  });

  it('has no route that creates a supervisor token', async () => {
    const token = await supervisorToken();

    const response = await send({
      method: 'POST',
      path: '/v1/supervisor-tokens',
      token,
      json: { name: 'attacker' },
    });

    expect(response.status).toBe(404);
  });

  it('has no route that backs up to a server path', async () => {
    const token = await supervisorToken();

    const response = await send({
      method: 'POST',
      path: '/v1/admin/backup',
      token,
      json: { file: '/tmp/anything.db' },
    });

    expect(response.status).toBe(404);
  });
});

describe('the SSE stream', () => {
  it('refuses a stream with no token', async () => {
    const response = await send({ path: '/v1/stream' });

    expect(response.status).toBe(401);
  });

  it('answers a stream with a supervisor token as event-stream', async () => {
    const token = await supervisorToken();
    const controller = new AbortController();
    const response = await app.request('/v1/stream?after=0', {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    controller.abort();
  });
});

/** The hello body a Cell sends, with its cellId. */
const helloBody = (cellId: string) => ({
  cellId,
  version: '0.1.0',
  projects: [PROJECT],
  runners: ['claude'],
  capabilities: [],
  slots: 1,
});

/** A blob ref of some bytes: `sha256:<hex>`, the form the runtime verifies. */
const blobRef = (bytes: Uint8Array): BlobRef =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;
