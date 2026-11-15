import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellId, ProjectId } from '@repo/factory-core/ids';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { createHttpApp } from '../http/app';
import { type Caller, createAuthCache } from '../http/auth-cache';

const PROJECT = 'software-factory' as ProjectId;
const CELL_NAME = 'cell-under-test';

const CELL_A = 'cell-a' as CellId;
const CELL_B = 'cell-b' as CellId;

describe('auth cache', () => {
  it('serves a stored caller until its TTL passes', () => {
    const cache = createAuthCache(1000);
    const caller: Caller = { kind: 'cell', cellId: CELL_A };
    cache.set('digest', caller, cache.generation(), 0);

    expect(cache.get('digest', 999)).toEqual(caller);
    expect(cache.get('digest', 1000)).toBeUndefined();
  });

  it('evicts only the entries that name the revoked Cell', () => {
    const cache = createAuthCache();
    const supervisor: Caller = { kind: 'supervisor', name: 'dev' };
    cache.set('a', { kind: 'cell', cellId: CELL_A }, cache.generation(), 0);
    cache.set('b', { kind: 'cell', cellId: CELL_B }, cache.generation(), 0);
    cache.set('s', supervisor, cache.generation(), 0);

    cache.evictCell(CELL_A);

    expect(cache.get('a', 0)).toBeUndefined();
    expect(cache.get('b', 0)).toEqual({ kind: 'cell', cellId: CELL_B });
    expect(cache.get('s', 0)).toEqual(supervisor);
  });

  it('does not store a result that was looked up before an eviction', () => {
    const cache = createAuthCache();
    const generation = cache.generation();
    cache.evictCell(CELL_A);

    cache.set('late', { kind: 'cell', cellId: CELL_A }, generation, 0);

    expect(cache.get('late', 0)).toBeUndefined();
  });

  it('clears every entry', () => {
    const cache = createAuthCache();
    cache.set('a', { kind: 'cell', cellId: CELL_A }, cache.generation(), 0);
    cache.set('s', { kind: 'supervisor', name: 'dev' }, cache.generation(), 0);

    cache.clear();

    expect(cache.get('a', 0)).toBeUndefined();
    expect(cache.get('s', 0)).toBeUndefined();
  });
});

let dataDir: string;
let opened: OpenedRuntime;
let app: ReturnType<typeof createHttpApp>;

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-auth-cache-'));
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

/** One request through the Hono app with an optional bearer token. */
const send = (
  path: string,
  options: { method?: string; token?: string; json?: unknown } = {},
): Promise<Response> => {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method: options.method ?? 'GET',
      headers,
      body:
        options.json === undefined ? undefined : JSON.stringify(options.json),
    }),
  );
};

const supervisorToken = async (): Promise<string> =>
  (await opened.runtime.remote.createSupervisorToken('dev')).token;

/** Joins a Cell and says hello, as a Cell does on first start: a Cell that has not said hello is refused. */
const joinCell = async (): Promise<{ cellId: CellId; credential: string }> => {
  const created = await opened.runtime.call('joinTokenCreate', {
    commandId: `cmd-cell-${Math.random()}`,
    name: 'pool',
  });
  const response = await send('/v1/cell/join', {
    method: 'POST',
    json: { joinToken: created.token, name: CELL_NAME },
  });
  expect(response.status).toBe(200);
  const joined = (await response.json()) as {
    cellId: CellId;
    credential: string;
  };
  const hello = await send('/v1/cell/hello', {
    method: 'POST',
    token: joined.credential,
    json: {
      cellId: joined.cellId,
      version: '0.1.0',
      projects: [PROJECT],
      runners: ['claude'],
      capabilities: [],
      slots: 1,
    },
  });
  expect(hello.status).toBe(200);
  return joined;
};

/** A Cell route the Cell's credential may call: the claim, which answers at once with no job. */
const claimAs = (token: string): Promise<Response> =>
  send('/v1/cell/claim', {
    method: 'POST',
    token,
    json: { waitMs: 0 },
  });

describe('HTTP auth cache', () => {
  it('looks up a supervisor token once, then serves the next requests from the cache', async () => {
    const token = await supervisorToken();
    const lookup = vi.spyOn(opened.runtime.remote, 'supervisorName');

    expect((await send('/v1/board', { token })).status).toBe(200);
    expect((await send('/v1/board', { token })).status).toBe(200);

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('looks up a Cell credential once, then serves the next requests from the cache', async () => {
    const lookup = vi.spyOn(opened.runtime.remote, 'cellOf');
    // The join's hello is the first request with the credential: it does the one lookup.
    const cell = await joinCell();

    expect((await claimAs(cell.credential)).status).not.toBe(401);
    expect((await claimAs(cell.credential)).status).not.toBe(401);

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('refuses a cached Cell credential at once after an HTTP revoke', async () => {
    const cell = await joinCell();
    const supervisor = await supervisorToken();
    expect((await claimAs(cell.credential)).status).not.toBe(401);

    await send(`/v1/cells/${cell.cellId}`, {
      method: 'DELETE',
      token: supervisor,
    });

    expect((await claimAs(cell.credential)).status).toBe(401);
  });

  it('refuses a cached Cell credential at once after a revoke over the socket path', async () => {
    const cell = await joinCell();
    expect((await claimAs(cell.credential)).status).not.toBe(401);

    // The socket and in-process callers revoke through the runtime, not through this app.
    await opened.runtime.call('cellRevoke', { cellId: cell.cellId });

    expect((await claimAs(cell.credential)).status).toBe(401);
  });

  it('never caches a wrong or unknown token', async () => {
    const lookup = vi.spyOn(opened.runtime.remote, 'supervisorName');
    const other = vi.spyOn(opened.runtime.remote, 'cellOf');

    expect((await send('/v1/board', { token: 'not-issued-here' })).status).toBe(
      401,
    );
    expect((await send('/v1/board', { token: 'not-issued-here' })).status).toBe(
      401,
    );

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(0);
  });

  it('does not admit a cached supervisor credential on a Cell route', async () => {
    const token = await supervisorToken();
    expect((await send('/v1/board', { token })).status).toBe(200);

    expect((await claimAs(token)).status).toBe(401);
  });
});
