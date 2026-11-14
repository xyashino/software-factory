import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  newCycleToken,
  readRequest,
  startOperatorSocket,
  type OperatorSocket,
} from '../../operator-socket';

const TOKEN = 'a'.repeat(48);
const dirs: string[] = [];
const sockets: OperatorSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) await socket.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const socketDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'op-'));
  dirs.push(dir);
  return dir;
};

/** Sends one line to a socket and returns the one line that comes back. */
const exchange = (path: string, line: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const client = createConnection(path);
    let reply = '';
    client.setEncoding('utf8');
    client.on('connect', () => client.write(`${line}\n`));
    client.on('data', (chunk: string) => (reply += chunk));
    client.on('end', () => resolve(reply.trim()));
    client.on('error', reject);
  });

describe('operator socket request checks', () => {
  it('accepts a verb carrying the right token', () => {
    const checked = readRequest(
      JSON.stringify({ token: TOKEN, op: 'done' }),
      TOKEN,
    );
    expect(checked).toEqual({
      ok: true,
      request: { token: TOKEN, op: 'done' },
    });
  });

  it('refuses a missing or wrong token as unauthorized', () => {
    expect(readRequest(JSON.stringify({ op: 'done' }), TOKEN)).toMatchObject({
      ok: false,
      reply: { code: 'unauthorized' },
    });
    expect(
      readRequest(JSON.stringify({ token: 'b'.repeat(48), op: 'done' }), TOKEN),
    ).toMatchObject({
      ok: false,
      reply: { code: 'unauthorized' },
    });
  });

  it('refuses an unknown verb and an extra field as invalid, with the field named', () => {
    const unknown = readRequest(
      JSON.stringify({ token: TOKEN, op: 'explode' }),
      TOKEN,
    );
    expect(unknown).toMatchObject({ ok: false, reply: { code: 'invalid' } });
    const extra = readRequest(
      JSON.stringify({ token: TOKEN, op: 'done', extra: 1 }),
      TOKEN,
    );
    expect(extra).toMatchObject({ ok: false, reply: { code: 'invalid' } });
  });

  it('refuses a line that is not JSON', () => {
    expect(readRequest('not json', TOKEN)).toMatchObject({
      ok: false,
      reply: { code: 'invalid' },
    });
  });

  it('issues a fresh 48-character hex token per Cycle', () => {
    const first = newCycleToken();
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(newCycleToken()).not.toBe(first);
  });
});

describe('operator socket server', () => {
  it('binds the socket with mode 0600, reachable by its owner only', async () => {
    const path = join(socketDir(), 'op.sock');
    sockets.push(
      await startOperatorSocket({
        path,
        token: TOKEN,
        dispatch: async () => ({ ok: true }),
      }),
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('answers a verb that passes the checks with the dispatcher reply', async () => {
    const path = join(socketDir(), 'op.sock');
    sockets.push(
      await startOperatorSocket({
        path,
        token: TOKEN,
        dispatch: async (request) => ({ ok: true, result: { op: request.op } }),
      }),
    );
    const reply = await exchange(
      path,
      JSON.stringify({ token: TOKEN, op: 'context' }),
    );
    expect(JSON.parse(reply)).toEqual({ ok: true, result: { op: 'context' } });
  });

  it('refuses a wrong token without reaching the dispatcher', async () => {
    const path = join(socketDir(), 'op.sock');
    let reached = false;
    sockets.push(
      await startOperatorSocket({
        path,
        token: TOKEN,
        dispatch: async () => {
          reached = true;
          return { ok: true };
        },
      }),
    );
    const reply = await exchange(
      path,
      JSON.stringify({ token: 'x', op: 'done' }),
    );
    expect(JSON.parse(reply)).toMatchObject({
      ok: false,
      code: 'unauthorized',
    });
    expect(reached).toBe(false);
  });

  it('refuses a socket path too long for the unix limit', async () => {
    const long = join(socketDir(), 'x'.repeat(120), 'op.sock');
    await expect(
      startOperatorSocket({
        path: long,
        token: TOKEN,
        dispatch: async () => ({ ok: true }),
      }),
    ).rejects.toThrow(/too long/);
  });
});
