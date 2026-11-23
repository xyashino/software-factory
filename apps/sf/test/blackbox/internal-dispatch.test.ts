import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const POLL_MS = 100;
const TOKEN_PATTERN = /^\S{16,}$/;

const dirs: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-internal-'));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('internal server marker', () => {
  it('prints a operator token for admin token create', () => {
    // Arrange
    const dbDir = makeDir();
    const env = {
      ...process.env,
      FACTORY_DATA_DIR: dbDir,
      FACTORY_DB_PATH: join(dbDir, 'factory.db'),
    };

    // Act
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, '__server', 'admin', 'token', 'create'],
      { env, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS },
    );

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(TOKEN_PATTERN);
  });
});

describe('internal factory daemon marker', () => {
  it('runs the factory daemon when started with the daemon marker', async () => {
    // Arrange
    const dataDir = makeDir();
    const port = await freePort();
    const child = spawn(process.execPath, [CLI_PATH, '__factory-daemon'], {
      env: {
        ...process.env,
        XDG_DATA_HOME: dataDir,
        SF_FACTORY_PORT: String(port),
      },
    });

    try {
      // Act
      const health = await waitForHealth(port);

      // Assert
      expect(health).toEqual({ pid: child.pid });
    } finally {
      child.kill('SIGTERM');
    }
  });
});

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('no free port'));
          return;
        }
        resolve(address.port);
      });
    });
  });

const waitForHealth = async (port: number): Promise<unknown> => {
  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return await response.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
  throw new Error('factory daemon did not start');
};
