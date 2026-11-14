import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

const socketPath = (): string => join(dataDir, 'factory.sock');

/** Starts a server and waits until its socket is listening. */
const startServer = async (): Promise<Bun.Subprocess> => {
  const child = Bun.spawn(['bun', MAIN], {
    env: { ...process.env, FACTORY_DATA_DIR: dataDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  children.push(child);
  for (let waited = 0; waited < 10_000; waited += 50) {
    if (existsSync(socketPath())) return child;
    await Bun.sleep(50);
  }
  throw new Error('the server did not open its socket');
};

/** Socket inodes a process holds, from its file descriptors. */
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
      env: { ...process.env, FACTORY_DATA_DIR: dataDir },
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
    first.kill('SIGKILL');
    await first.exited;

    const second = await startServer();

    expect(second.exitCode).toBeNull();
    expect(statSync(socketPath()).isSocket()).toBe(true);
  });

  it('removes the socket file on a clean SIGTERM', async () => {
    const child = await startServer();

    child.kill('SIGTERM');
    await child.exited;

    expect(existsSync(socketPath())).toBe(false);
  });

  it('opens the socket with mode 0600 and no TCP listener belongs to the server', async () => {
    const child = await startServer();

    const mode = statSync(socketPath()).mode & 0o777;
    const own = socketInodes(child.pid);
    const listening = listeningTcpInodes();
    const tcpOwned = [...own].filter((inode) => listening.has(inode));

    expect(mode).toBe(0o600);
    expect(tcpOwned).toEqual([]);
  });
});
