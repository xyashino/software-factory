import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { seedProject } from '@repo/factory-runtime/seed';

/** The server entry point, run as a real process with its own data directory. */
const MAIN = fileURLToPath(new URL('../main.ts', import.meta.url));

const children: Bun.Subprocess[] = [];
let dataDir: string | undefined;

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
    await child.exited;
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

/** The socket inodes a process holds, from its file descriptors. */
const socketInodesOf = (pid: number): Set<string> => {
  const inodes = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try {
      const match = /^socket:\[(\d+)\]$/.exec(
        readlinkSync(`/proc/${pid}/fd/${fd}`),
      );
      if (match?.[1]) inodes.add(match[1]);
    } catch {
      // the descriptor closed while we looked
    }
  }
  return inodes;
};

/** The inodes of every TCP socket in LISTEN state, IPv4 and IPv6 (`/proc/net/tcp*`, state 0A). */
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

describe('factory-server network surface', () => {
  it('holds a unix socket and no listening TCP socket', async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'factory-network-'));
    seedProject(dataDir, {
      projectId: 'software-factory',
      repoUrl: 'https://example.test/software-factory.git',
    });
    const child = Bun.spawn(['bun', MAIN], {
      env: { ...process.env, FACTORY_DATA_DIR: dataDir },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.push(child);
    const socketPath = join(dataDir, 'factory.sock');
    for (
      let waited = 0;
      waited < 10_000 && !existsSync(socketPath);
      waited += 50
    ) {
      await Bun.sleep(50);
    }
    expect(existsSync(socketPath)).toBe(true);

    const held = socketInodesOf(child.pid);
    const listening = listeningTcpInodes();

    expect(held.size).toBeGreaterThan(0);
    expect([...held].filter((inode) => listening.has(inode))).toEqual([]);
  });
});
