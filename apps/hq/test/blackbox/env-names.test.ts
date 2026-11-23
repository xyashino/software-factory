import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SERVER_ENTRY = fileURLToPath(
  new URL('../../src/index.ts', import.meta.url),
);
const START_TIMEOUT_MS = 15_000;
const LISTENING = 'listening on';

const running: ChildProcess[] = [];
const dirs: string[] = [];

interface Sandbox {
  home: string;
  dataHome: string;
}

const createSandbox = (): Sandbox => {
  const home = mkdtempSync(join(tmpdir(), 'hq-env-names-'));
  dirs.push(home);
  const dataHome = join(home, 'xdg');
  mkdirSync(join(dataHome, 'sf'), { recursive: true });
  return { home, dataHome };
};

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

const stopAll = (): void => {
  for (const child of running.splice(0)) {
    child.kill();
  }
};

afterEach(() => {
  stopAll();
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('HQ environment names', () => {
  it('starts on HQ_PORT and HQ_HOST with HQ_DB_PATH and HQ_DATA_DIR only', async () => {
    // Arrange
    const sandbox = createSandbox();
    const port = await freePort();
    const dbPath = join(sandbox.home, 'state', 'hq.db');

    // Act
    const stdout = await startHq({
      HQ_PORT: String(port),
      HQ_HOST: '127.0.0.1',
      HQ_DB_PATH: dbPath,
      HQ_DATA_DIR: join(sandbox.home, 'state'),
    });

    // Assert
    expect(stdout).toContain(
      `listening on http://127.0.0.1:${port} (db ${dbPath})`,
    );
    expect(existsSync(dbPath)).toBe(true);
  });

  it('starts the same way when only the old FACTORY_* names are set', async () => {
    // Arrange
    const sandbox = createSandbox();
    const port = await freePort();
    const dbPath = join(sandbox.home, 'state', 'hq.db');

    // Act
    const stdout = await startHq({
      FACTORY_PORT: String(port),
      FACTORY_HOST: '127.0.0.1',
      FACTORY_DB_PATH: dbPath,
      FACTORY_DATA_DIR: join(sandbox.home, 'state'),
    });

    // Assert
    expect(stdout).toContain(
      `listening on http://127.0.0.1:${port} (db ${dbPath})`,
    );
    expect(existsSync(dbPath)).toBe(true);
  });

  it('lets HQ_PORT win over a stale FACTORY_PORT', async () => {
    // Arrange
    const sandbox = createSandbox();
    const port = await freePort();
    const stalePort = await freePort();
    const dbPath = join(sandbox.home, 'hq.db');

    // Act
    const stdout = await startHq({
      HQ_PORT: String(port),
      FACTORY_PORT: String(stalePort),
      HQ_DB_PATH: dbPath,
    });

    // Assert
    expect(stdout).toContain(`listening on http://127.0.0.1:${port} `);
  });

  it('opens an existing factory.db when hq.db is absent', async () => {
    // Arrange
    const sandbox = createSandbox();
    const legacyDb = join(sandbox.dataHome, 'sf', 'factory.db');
    const firstPort = await freePort();
    await startHq({
      XDG_DATA_HOME: sandbox.dataHome,
      HQ_PORT: String(firstPort),
      HQ_DB_PATH: legacyDb,
    });
    stopAll();
    const port = await freePort();

    // Act
    const stdout = await startHq({
      XDG_DATA_HOME: sandbox.dataHome,
      HQ_PORT: String(port),
    });

    // Assert
    expect(stdout).toContain(`(db ${legacyDb})`);
    expect(existsSync(join(sandbox.dataHome, 'sf', 'hq.db'))).toBe(false);
  });

  it('prefers hq.db over factory.db when both exist', async () => {
    // Arrange
    const sandbox = createSandbox();
    const dataDir = join(sandbox.dataHome, 'sf');
    writeFileSync(join(dataDir, 'factory.db'), '');
    const currentDb = join(dataDir, 'hq.db');
    const firstPort = await freePort();
    await startHq({
      XDG_DATA_HOME: sandbox.dataHome,
      HQ_PORT: String(firstPort),
      HQ_DB_PATH: currentDb,
    });
    stopAll();
    const port = await freePort();

    // Act
    const stdout = await startHq({
      XDG_DATA_HOME: sandbox.dataHome,
      HQ_PORT: String(port),
    });

    // Assert
    expect(stdout).toContain(`(db ${currentDb})`);
  });
});
