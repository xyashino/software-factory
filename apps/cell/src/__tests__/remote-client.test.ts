import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { CellId } from '@repo/factory-core/ids';
import { ensureCredential, readIdentity } from '../identity';
import { joinRemote, remoteFactoryClient } from '../remote-client';

const CELL = '01J0000000000000000000000W' as CellId;
const BASE = 'http://factory.example:7878';
const noSleep = async () => undefined;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A fetch that answers from a script, one answer per call, and records each request. */
const scripted = (answers: (Response | Error)[]) => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), init });
    const next = answers.shift();
    if (next === undefined) throw new Error('no more scripted answers');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetchImpl, requests };
};

const hello = {
  cellId: CELL,
  version: '0.1.0',
  projects: [],
  runners: [],
  capabilities: [],
  slots: 1,
};

describe('remote Cell client', () => {
  it('sends the credential as a bearer to the Cell route', async () => {
    const { fetchImpl, requests } = scripted([
      json(200, {
        cellId: CELL,
        config: {
          leaseTtlMs: 60000,
          heartbeatMs: 15000,
          reaperMs: 5000,
          selfFenceMs: 45000,
        },
      }),
    ]);
    const client = remoteFactoryClient({
      baseUrl: BASE,
      credential: 'cred-abc',
      fetchImpl,
      sleep: noSleep,
    });

    await client.call('hello', hello);

    expect(requests[0]?.url).toBe(`${BASE}/v1/cell/hello`);
    expect(
      (requests[0]?.init.headers as Record<string, string>).authorization,
    ).toBe('Bearer cred-abc');
  });

  it('refuses a supervisor route without a call', async () => {
    const { fetchImpl, requests } = scripted([]);
    const client = remoteFactoryClient({
      baseUrl: BASE,
      credential: 'cred',
      fetchImpl,
      sleep: noSleep,
    });

    await expect(client.call('board', {})).rejects.toThrow(
      'board is not a Cell route',
    );
    expect(requests).toHaveLength(0);
  });

  it('gives up on a 401 at once, so the caller can join again', async () => {
    const { fetchImpl, requests } = scripted([
      json(401, { code: 'unauthorized' }),
    ]);
    const client = remoteFactoryClient({
      baseUrl: BASE,
      credential: 'revoked',
      fetchImpl,
      sleep: noSleep,
    });

    await expect(client.call('hello', hello)).rejects.toMatchObject({
      status: 401,
      error: { code: 'unauthorized' },
    });
    expect(requests).toHaveLength(1);
  });

  it('retries a 5xx with the same body, then succeeds', async () => {
    const ok = json(200, {
      cellId: CELL,
      config: {
        leaseTtlMs: 1,
        heartbeatMs: 1,
        reaperMs: 1,
        selfFenceMs: 1,
      },
    });
    const { fetchImpl, requests } = scripted([
      json(503, { code: 'unavailable' }),
      ok,
    ]);
    const client = remoteFactoryClient({
      baseUrl: BASE,
      credential: 'cred',
      fetchImpl,
      sleep: noSleep,
    });

    await client.call('hello', hello);

    expect(requests).toHaveLength(2);
    expect(requests[1]?.init.body).toBe(requests[0]?.init.body);
  });

  it('retries a lost answer, then reports unavailable when the attempts run out', async () => {
    const { fetchImpl, requests } = scripted([
      new Error('connection reset'),
      new Error('connection reset'),
      new Error('connection reset'),
    ]);
    const client = remoteFactoryClient({
      baseUrl: BASE,
      credential: 'cred',
      attempts: 3,
      fetchImpl,
      sleep: noSleep,
    });

    const refused = client.call('hello', hello);

    await expect(refused).rejects.toBeInstanceOf(WireFailure);
    await expect(refused).rejects.toMatchObject({
      error: { code: 'unavailable' },
    });
    expect(requests).toHaveLength(3);
  });

  it('keeps the wire error of a stale epoch without retrying it', async () => {
    const { fetchImpl, requests } = scripted([
      json(409, { code: 'stale_epoch', current: 2 }),
    ]);
    const client = remoteFactoryClient({
      baseUrl: BASE,
      credential: 'cred',
      fetchImpl,
      sleep: noSleep,
    });

    await expect(
      client.call('submitCommand', {
        cellId: CELL,
        orderId: 'software-factory:todo-1' as never,
        jobId: '01J0000000000000000000000J' as never,
        commandId: 'job:start',
        epoch: 1,
        command: { type: 'StartCycle', baseCommit: 'b'.repeat(40) as never },
      }),
    ).rejects.toMatchObject({
      status: 409,
      error: { code: 'stale_epoch', current: 2 },
    });
    expect(requests).toHaveLength(1);
  });
});

describe('joining', () => {
  it('returns the cellId and credential the Factory names', async () => {
    const { fetchImpl, requests } = scripted([
      json(200, { cellId: CELL, credential: 'c'.repeat(43) }),
    ]);

    const joined = await joinRemote({
      baseUrl: BASE,
      joinToken: 'j'.repeat(43),
      name: 'host-a',
      fetchImpl,
    });

    expect(joined).toEqual({ cellId: CELL, credential: 'c'.repeat(43) });
    expect(requests[0]?.url).toBe(`${BASE}/v1/cell/join`);
  });

  it('refuses a rejected join token as unauthorized', async () => {
    const { fetchImpl } = scripted([json(401, { code: 'unauthorized' })]);

    await expect(
      joinRemote({
        baseUrl: BASE,
        joinToken: 'x'.repeat(43),
        name: 'host-a',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('the stored credential', () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is reused without joining again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cell-cred-'));
    await ensureCredential(dir, async () => ({
      cellId: CELL,
      credential: 'first-credential',
    }));
    let joins = 0;

    const again = await ensureCredential(dir, async () => {
      joins += 1;
      return { cellId: CELL, credential: 'second-credential' };
    });

    expect(joins).toBe(0);
    expect(again.credential).toBe('first-credential');
  });

  it('is stored with mode 0600 and replaces a local identity that has no credential', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cell-cred-'));
    const other = '01J0000000000000000000000Z' as CellId;
    await ensureCredential(dir, async () => ({
      cellId: other,
      credential: 'joined-credential',
    }));

    expect(readIdentity(dir)).toEqual({
      cellId: other,
      credential: 'joined-credential',
    });
    expect(statSync(join(dir, 'credential')).mode & 0o777).toBe(0o600);
  });
});
