import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const PID_MODE = 0o600;

interface Sandbox {
  home: string;
  dataDir: string;
  port: number;
  env: Record<string, string>;
}

const sandboxes: Sandbox[] = [];
const orphanPids: number[] = [];

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

const createSandbox = async (): Promise<Sandbox> => {
  const home = mkdtempSync(join(tmpdir(), 'factory-cli-'));
  const dataDir = join(home, 'data');
  const port = await freePort();
  const sandbox: Sandbox = {
    home,
    dataDir,
    port,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      FACTORY_DATA_DIR: dataDir,
      FACTORY_DB_PATH: join(home, 'factory.db'),
      FACTORY_PORT: String(port),
      FACTORY_URL: `http://127.0.0.1:${port}`,
    },
  };
  sandboxes.push(sandbox);
  return sandbox;
};

const runCli = (sandbox: Sandbox, args: readonly string[]) =>
  spawnSync(process.execPath, [CLI_PATH, 'server', ...args], {
    env: sandbox.env,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });

const pidFileOf = (sandbox: Sandbox): string =>
  join(sandbox.dataDir, 'server.pid');

const baseUrlOf = (sandbox: Sandbox): string =>
  `http://127.0.0.1:${sandbox.port}/`;

const sleeperAt = (sandbox: Sandbox): number => {
  const launched = spawnSync(
    'sh',
    [
      '-c',
      '"$0" -e "setInterval(() => {}, 1000)" >/dev/null 2>&1 & echo $!',
      process.execPath,
    ],
    { encoding: 'utf8' },
  );
  const pid = Number(launched.stdout.trim());
  orphanPids.push(pid);
  mkdirSync(sandbox.dataDir, { recursive: true });
  writeFileSync(pidFileOf(sandbox), `${pid}\n`);
  return pid;
};

const recordingServer = (port: number) => {
  const requests: string[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.end('{}');
  });
  return new Promise<{ requests: string[]; close: () => Promise<void> }>(
    (resolve) => {
      server.listen(port, '127.0.0.1', () =>
        resolve({
          requests,
          close: () =>
            new Promise((done) => {
              server.close(() => done());
            }),
        }),
      );
    },
  );
};

afterAll(async () => {
  for (const pid of orphanPids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      continue;
    }
  }
  for (const sandbox of sandboxes) {
    runCli(sandbox, ['stop']);
    rmSync(sandbox.home, { recursive: true, force: true });
  }
});

describe('factory server start and stop', () => {
  it('starts the server and answers on its base URL', async () => {
    // Arrange
    const sandbox = await createSandbox();

    // Act
    const result = runCli(sandbox, ['start']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('server started');
    await expect(fetch(baseUrlOf(sandbox))).resolves.toBeInstanceOf(Response);
    expect(statSync(pidFileOf(sandbox)).mode & 0o777).toBe(PID_MODE);
  });

  it('refuses a second start while the first server runs', async () => {
    // Arrange
    const sandbox = await createSandbox();
    runCli(sandbox, ['start']);

    // Act
    const result = runCli(sandbox, ['start']);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('server already running');
  });

  it('stops the server process and removes server.pid', async () => {
    // Arrange
    const sandbox = await createSandbox();
    runCli(sandbox, ['start']);

    // Act
    const result = runCli(sandbox, ['stop']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('server stopped');
    expect(existsSync(pidFileOf(sandbox))).toBe(false);
    await expect(fetch(baseUrlOf(sandbox))).rejects.toThrow();
  });

  it('reports server not running when no server.pid exists', async () => {
    // Arrange
    const sandbox = await createSandbox();

    // Act
    const result = runCli(sandbox, ['stop']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('server not running');
  });

  it('sends no cells request while stopping the server', async () => {
    // Arrange
    const sandbox = await createSandbox();
    const recorder = await recordingServer(sandbox.port);
    sleeperAt(sandbox);

    // Act
    const result = runCli(sandbox, ['stop']);
    await recorder.close();

    // Assert
    expect(result.status).toBe(0);
    expect(recorder.requests).toEqual([]);
  });
});

describe('factory server token create', () => {
  it('prints the token once when no save flag is given', async () => {
    // Arrange
    const sandbox = await createSandbox();

    // Act
    const result = runCli(sandbox, ['token', 'create']);

    // Assert
    const lines = result.stdout.trim().split('\n');
    expect(result.status).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.length).toBeGreaterThan(0);
    expect(result.stderr).not.toContain(lines[0]);
  });

  it('writes the token file with --save and prints nothing', async () => {
    // Arrange
    const sandbox = await createSandbox();
    const tokenFile = join(sandbox.home, '.config', 'factory', 'token');

    // Act
    const result = runCli(sandbox, ['token', 'create', '--save']);

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(readFileSync(tokenFile, 'utf8').trim().length).toBeGreaterThan(0);
    expect(statSync(tokenFile).mode & 0o777).toBe(PID_MODE);
  });
});
