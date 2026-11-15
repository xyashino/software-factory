import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseDiscovery,
  type Discovery,
} from '@repo/factory-core/contracts/discovery';

/** The server entry point, run as a real process with its own data directory. */
const MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));

let dataDir: string;
const children: Bun.Subprocess[] = [];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'factory-process-'));
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
    await child.exited;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

const discoveryPath = (): string => join(dataDir, 'server.json');

/** The discovery file as a server wrote it, or undefined while it is absent. */
const discoveryNow = (): Discovery | undefined =>
  existsSync(discoveryPath())
    ? parseDiscovery(readFileSync(discoveryPath(), 'utf8'))
    : undefined;

/** The server's environment: its own data directory, on a free loopback port. */
const serverEnv = (bind = '127.0.0.1:0'): Record<string, string> => ({
  ...(process.env as Record<string, string>),
  FACTORY_DATA_DIR: dataDir,
  FACTORY_BIND: bind,
});

/**
 * Starts a server and waits until its discovery file names it. A file left by a killed server carries
 * the previous token, so the wait ends only on a token that differs from `previousToken`.
 */
const startServer = async (previousToken?: string): Promise<Bun.Subprocess> => {
  const child = Bun.spawn(['bun', MAIN], {
    env: serverEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  children.push(child);
  for (let waited = 0; waited < 10_000; waited += 50) {
    const current = discoveryNow();
    if (current !== undefined && current.token !== previousToken) return child;
    await Bun.sleep(50);
  }
  throw new Error('the server did not write its discovery file');
};

/** Inodes of the sockets a process holds, from its file descriptors. */
const socketInodes = (pid: number): Set<string> => {
  const inodes = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try {
      const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (match?.[1]) inodes.add(match[1]);
    } catch {
      // The descriptor closed while we looked.
    }
  }
  return inodes;
};

/** Inodes of TCP sockets in LISTEN state (state 0A), from the kernel's tables. */
const listeningTcpInodes = (): Set<string> => {
  const inodes = new Set<string>();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const rows = readFileSync(table, 'utf8').split('\n').slice(1);
    for (const row of rows) {
      const fields = row.trim().split(/\s+/);
      if (fields[3] === '0A' && fields[9]) inodes.add(fields[9]);
    }
  }
  return inodes;
};

describe('factory-server as a process', () => {
  it('refuses a second server on the same data directory at once', async () => {
    await startServer();
    const started = performance.now();

    const second = Bun.spawn(['bun', MAIN], {
      env: serverEnv(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.push(second);
    const code = await second.exited;
    const elapsed = performance.now() - started;
    const stderr = await new Response(second.stderr).text();

    expect(code).toBe(1);
    expect(stderr).toContain('another factory-server holds');
    expect(elapsed).toBeLessThan(10_000);
  });

  it('starts again once the first server is killed, because the kernel released the lock', async () => {
    const first = await startServer();
    const firstToken = discoveryNow()?.token;
    first.kill('SIGKILL');
    await first.exited;

    const second = await startServer(firstToken);

    expect(second.exitCode).toBeNull();
    expect(discoveryNow()?.token).not.toBe(firstToken);
  });

  it('removes the discovery file on a clean SIGTERM', async () => {
    const child = await startServer();

    child.kill('SIGTERM');
    await child.exited;

    expect(existsSync(discoveryPath())).toBe(false);
  });

  it('writes the discovery file with mode 0600 and a loopback URL', async () => {
    await startServer();

    const mode = statSync(discoveryPath()).mode & 0o777;
    const url = new URL(discoveryNow()!.url);

    expect(mode).toBe(0o600);
    expect(url.hostname).toBe('127.0.0.1');
  });

  it('serves HTTP on loopback only: the server owns a listening TCP socket, and no Unix socket', async () => {
    const child = await startServer();

    const own = socketInodes(child.pid);
    const listening = listeningTcpInodes();
    const tcpOwned = [...own].filter((inode) => listening.has(inode));

    expect(tcpOwned.length).toBeGreaterThan(0);
    expect(existsSync(join(dataDir, 'factory.sock'))).toBe(false);
  });

  it('answers the local token on the discovery URL, and refuses a request without one', async () => {
    await startServer();
    const discovery = discoveryNow()!;

    const anonymous = await fetch(`${discovery.url}/v1/board`);
    const local = await fetch(`${discovery.url}/v1/board`, {
      headers: { authorization: `Bearer ${discovery.token}` },
    });

    expect(anonymous.status).toBe(401);
    expect(local.status).toBe(200);
  });

  it('refuses to start, and writes no discovery file, when its port is taken', async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
    const port = (taken.address() as { port: number }).port;
    try {
      const child = Bun.spawn(['bun', MAIN], {
        env: serverEnv(`127.0.0.1:${port}`),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      children.push(child);
      const code = await child.exited;
      const stderr = await new Response(child.stderr).text();

      expect(code).toBe(1);
      expect(stderr).toContain(`cannot listen on 127.0.0.1:${port}`);
      expect(existsSync(discoveryPath())).toBe(false);
    } finally {
      await new Promise<void>((resolve) => taken.close(() => resolve()));
    }
  });
});
