import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { ProjectId, WorkerId } from '@repo/factory-core/ids';
import { seedProject } from '@repo/factory-runtime/seed';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { startSocketListener, type SocketListener } from '../socket/listener';
import { socketFactoryClient } from '../socket/client';

const WORKER = '01J0000000000000000000000W' as WorkerId;
const PROJECT = 'software-factory' as ProjectId;
const SOCKET = 'factory.sock';

let dataDir: string;
let opened: OpenedRuntime | undefined;
let listener: SocketListener | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-socket-'));
  seedProject(dataDir, {
    projectId: PROJECT,
    repoUrl: 'https://example.test/software-factory.git',
  });
});

afterEach(async () => {
  await listener?.stop();
  listener = undefined;
  opened?.close();
  opened = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

const serve = async (): Promise<string> => {
  opened = openRuntime({ dataDir });
  await opened.runtime.start();
  const socketPath = join(dataDir, SOCKET);
  listener = startSocketListener({ runtime: opened.runtime, socketPath });
  return socketPath;
};

/** A raw request on the socket, for the transport's own answers (404, 422). */
const raw = (
  socketPath: string,
  path: string,
  body: unknown,
  method = 'POST',
) =>
  fetch(`http://factory${path}`, {
    method,
    unix: socketPath,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  } as RequestInit);

describe('factory.sock', () => {
  it('is created as a socket with mode 0600', async () => {
    const socketPath = await serve();

    const stat = statSync(socketPath);

    expect(stat.isSocket()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('replaces a stale file at its path once the writer lock is held', async () => {
    writeFileSync(join(dataDir, SOCKET), 'left by a crashed run');

    const socketPath = await serve();

    expect(statSync(socketPath).isSocket()).toBe(true);
  });

  it('removes the socket file when the listener stops', async () => {
    const socketPath = await serve();

    await listener?.stop();
    listener = undefined;

    expect(() => statSync(socketPath)).toThrow();
  });
});

describe('socket client parity', () => {
  it('answers the same board as the runtime called directly', async () => {
    const socketPath = await serve();
    const client = socketFactoryClient({ socketPath });

    const viaSocket = await client.call('board', {});
    const direct = await opened!.runtime.call('board', {});

    expect(viaSocket).toEqual(direct);
  });

  it('answers the same Worker registration and claim as the runtime called directly', async () => {
    const socketPath = await serve();
    const client = socketFactoryClient({ socketPath });
    const hello = {
      workerId: WORKER,
      version: '0.1.0',
      projects: [PROJECT],
      runners: ['claude'],
      capabilities: [],
      slots: 1,
    };

    const viaSocket = await client.call('hello', hello);
    const direct = await opened!.runtime.call('hello', hello);
    const claim = await client.call('claim', { workerId: WORKER, waitMs: 0 });

    expect(viaSocket).toEqual(direct);
    expect(claim).toEqual({ job: null });
  });

  it('answers the same refusal as the runtime called directly', async () => {
    const socketPath = await serve();
    const client = socketFactoryClient({ socketPath });
    const request = { orderId: 'software-factory:missing' as never };

    const failure = await client
      .call('orderDetail', request)
      .catch((error: unknown) => error);
    const direct = await opened!.runtime.client
      .call('orderDetail', request)
      .catch((error: { wire: unknown }) => error);

    expect(failure).toBeInstanceOf(WireFailure);
    expect((failure as WireFailure).error).toEqual({ code: 'not_found' });
    expect((failure as WireFailure).status).toBe(404);
    expect((direct as { wire: unknown }).wire).toEqual({ code: 'not_found' });
  });
});

describe('the transport answers for itself', () => {
  it('answers a body the route schema refuses with 422 invalid', async () => {
    const socketPath = await serve();

    const response = await raw(socketPath, '/v1/worker/claim', {
      workerId: 'nope',
    });
    const body = (await response.json()) as { code: string; issues: string[] };

    expect(response.status).toBe(422);
    expect(body.code).toBe('invalid');
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it('answers an unknown route with 404', async () => {
    const socketPath = await serve();

    const response = await raw(socketPath, '/v1/worker/unknown', {});

    expect(response.status).toBe(404);
  });

  it('answers a GET with 404, because every route is a POST', async () => {
    const socketPath = await serve();

    const response = await raw(
      socketPath,
      '/v1/supervisor/board',
      undefined,
      'GET',
    );

    expect(response.status).toBe(404);
  });
});
