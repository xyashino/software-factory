import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/domain/exit-codes';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;

const dirs: string[] = [];

const closedPort = (): Promise<number> =>
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
  const home = mkdtempSync(join(tmpdir(), 'sf-stop-routing-'));
  dirs.push(home);
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    XDG_DATA_HOME: join(home, 'data'),
    SF_FACTORY_PORT: String(await closedPort()),
    FACTORY_URL: `http://127.0.0.1:${await closedPort()}`,
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

describe('cell stop routing', () => {
  it('refuses a stop without an id or --all', async () => {
    // Arrange
    const env = await sandboxEnv();

    // Act
    const result = runSf(env, ['cell', 'stop']);

    // Assert
    expect(result.status).toBe(EXIT.argument);
    expect(result.stderr).toContain('cell id required, or --all');
  });

  it('refuses a stop by id when no Factory daemon runs', async () => {
    // Arrange
    const env = await sandboxEnv();

    // Act
    const result = runSf(env, ['cell', 'stop', 'dev-box-2']);

    // Assert
    expect(result.status).toBe(EXIT.unreachable);
    expect(result.stderr).toContain(
      'factory not running: run "sf factory start"',
    );
  });

  it('refuses a stop of all cells when no Factory daemon runs', async () => {
    // Arrange
    const env = await sandboxEnv();

    // Act
    const result = runSf(env, ['cell', 'stop', '--all']);

    // Assert
    expect(result.status).toBe(EXIT.unreachable);
    expect(result.stderr).toContain(
      'factory not running: run "sf factory start"',
    );
  });
});
