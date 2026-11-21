import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;

const dirs: string[] = [];

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

const sandboxEnv = async (): Promise<Record<string, string>> => {
  const home = mkdtempSync(join(tmpdir(), 'sf-cell-server-'));
  dirs.push(home);
  const port = await freePort();
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_DATA_HOME: join(home, 'data'),
    CELL_SERVER_URL: `http://127.0.0.1:${port}`,
  };
};

const runSf = (env: Record<string, string>, args: readonly string[]) =>
  spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: env.HOME,
    env,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cell server lifecycle', () => {
  it('starts the local cell server, answers its settings, and stops it', async () => {
    // Arrange
    const env = await sandboxEnv();

    // Act
    const started = runSf(env, ['cell', 'server', 'start']);
    const status = runSf(env, ['cell', 'server', 'status', '--json']);
    const runner = runSf(env, [
      'cell',
      'server',
      'config',
      'get',
      'default_runner',
    ]);
    const stopped = runSf(env, ['cell', 'server', 'stop']);
    const stoppedAgain = runSf(env, ['cell', 'server', 'stop']);

    // Assert
    expect(started.status).toBe(0);
    expect(started.stdout).toContain('cell server started');
    expect(JSON.parse(status.stdout)).toMatchObject({
      healthy: true,
      alive: true,
      settings: { default_runner: 'claude' },
    });
    expect(runner.stdout.trim()).toBe('claude');
    expect(stopped.stdout.trim()).toBe('cell server stopped');
    expect(stoppedAgain.stdout.trim()).toBe('cell server not_running');
  });
});

describe('cell server settings and factories', () => {
  it('saves a factory target and makes it the default', async () => {
    // Arrange
    const env = await sandboxEnv();
    runSf(env, ['cell', 'server', 'start']);

    try {
      // Act
      const added = runSf(env, [
        'cell',
        'server',
        'factory',
        'add',
        'home',
        'http://10.0.0.5:7070',
        '--default',
      ]);
      const listed = runSf(env, ['cell', 'server', 'factory', 'ls', '--json']);
      const updated = runSf(env, [
        'cell',
        'server',
        'config',
        'set',
        'max_local_cells',
        '6',
      ]);
      const rejected = runSf(env, [
        'cell',
        'server',
        'config',
        'set',
        'bogus',
        '1',
      ]);

      // Assert
      expect(added.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toEqual([
        expect.objectContaining({
          name: 'home',
          url: 'http://10.0.0.5:7070',
          isDefault: true,
        }),
      ]);
      expect(updated.stdout.trim()).toBe('max_local_cells = 6');
      expect(rejected.status).not.toBe(0);
    } finally {
      runSf(env, ['cell', 'server', 'stop']);
    }
  });

  it('lists no local slots on a fresh cell server', async () => {
    // Arrange
    const env = await sandboxEnv();
    runSf(env, ['cell', 'server', 'start']);

    try {
      // Act
      const listed = runSf(env, ['cell', 'list', '--local', '--json']);

      // Assert
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toEqual([]);
    } finally {
      runSf(env, ['cell', 'server', 'stop']);
    }
  });
});
