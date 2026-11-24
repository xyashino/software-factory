import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { POSTGRES_URL } from '../support/postgres';

const SERVER_ENTRY = fileURLToPath(
  new URL('../../src/index.ts', import.meta.url),
);
const START_TIMEOUT_MS = 20_000;
const LISTENING = 'listening on';

const running: ChildProcess[] = [];
const dirs: string[] = [];

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address !== null
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });

const startHq = (env: Record<string, string>): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    running.push(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`HQ did not start: ${stderr}`));
    }, START_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.includes(LISTENING)) {
        clearTimeout(timer);
        resolve(stdout);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!stdout.includes(LISTENING)) {
        reject(new Error(`HQ exited ${code}: ${stderr}`));
      }
    });
  });

const createDataDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'hq-database-url-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(POSTGRES_URL === '')('HQ database selection', () => {
  it('starts on postgres when HQ_DATABASE_URL is set', async () => {
    // Arrange
    const port = await freePort();
    const dataDir = createDataDir();

    // Act
    const stdout = await startHq({
      HQ_PORT: String(port),
      HQ_HOST: '127.0.0.1',
      HQ_DATABASE_URL: POSTGRES_URL,
      HQ_DATA_DIR: dataDir,
    });

    // Assert
    expect(stdout).toContain(
      `listening on http://127.0.0.1:${port} (db postgres)`,
    );
  });

  it('starts on postgres when only FACTORY_DATABASE_URL is set', async () => {
    // Arrange
    const port = await freePort();
    const dataDir = createDataDir();

    // Act
    const stdout = await startHq({
      FACTORY_PORT: String(port),
      FACTORY_HOST: '127.0.0.1',
      FACTORY_DATABASE_URL: POSTGRES_URL,
      FACTORY_DATA_DIR: dataDir,
    });

    // Assert
    expect(stdout).toContain(
      `listening on http://127.0.0.1:${port} (db postgres)`,
    );
  });
});
