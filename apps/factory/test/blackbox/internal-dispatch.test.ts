import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
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
  it('prints a supervisor token for admin token create', () => {
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

describe('internal cell server marker', () => {
  it('runs the cell server when started with the cell server marker', async () => {
    // Arrange
    const dataDir = makeDir();
    const port = await freePort();
    const child = spawn(process.execPath, [CLI_PATH, '__cell-server'], {
      env: {
        ...process.env,
        XDG_DATA_HOME: dataDir,
        CELL_SERVER_HOST: '127.0.0.1',
        CELL_SERVER_PORT: String(port),
      },
    });

    try {
      // Act
      const listening = await firstLine(child.stdout, /listening on/);
      const health = await fetch(`http://127.0.0.1:${port}/api/v1/health`);

      // Assert
      expect(listening).toContain(`http://127.0.0.1:${port}`);
      expect(health.status).toBe(200);
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

const firstLine = (stream: Readable, pattern: RegExp): Promise<string> =>
  new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(
      () => reject(new Error('cell server did not start')),
      COMMAND_TIMEOUT_MS,
    );
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffered += chunk;
      const line = buffered.split('\n').find((text) => pattern.test(text));
      if (line !== undefined) {
        clearTimeout(timer);
        resolve(line);
      }
    });
  });
