import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/domain/exit-codes';
import { PROJECTS_REPLY, PROJECTS_ROUTE } from '../support/fake-ports';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 90_000;
const EXIT_WAIT_MS = 5_000;
const POLL_MS = 100;
const TOKEN = 'sf_supervisor_stub';
const FEATURE_LINE = 'name: feature\nstations: []\n';
const ENROLL_ROUTE = '/api/v1/cells/enroll';
const HELLO_ROUTE = '/api/v1/cells/hello';
const CLAIMS_ROUTE = '/api/v1/cells/claims';
const TOKENS_ROUTE = '/api/v1/tokens';
const HEARTBEAT_ROUTE = '/api/v1/factories/heartbeat';
const FACTORY_ID = 'factory-stub';
const FACTORY_SESSION = 'sf_factory_session_stub';

const sandboxes: Sandbox[] = [];
let factory: Server;
let factoryUrl: string;

interface Sandbox {
  env: Record<string, string>;
  repo: string;
  dataDir: string;
  port: number;
}

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface CreatedCell {
  cellId: string;
  name: string;
  pid: number;
}

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

const replyJson = (
  status: number,
  body: unknown,
  response: ServerResponse,
): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const writeCredential = (configHome: string): void => {
  mkdirSync(join(configHome, 'sf'), { recursive: true });
  writeFileSync(
    join(configHome, 'sf', 'factory.json'),
    JSON.stringify({
      url: factoryUrl,
      factoryId: FACTORY_ID,
      sessionToken: FACTORY_SESSION,
    }),
    { mode: 0o600 },
  );
};

const sandbox = async (
  options: { connected?: boolean } = {},
): Promise<Sandbox> => {
  const home = mkdtempSync(join(tmpdir(), 'sf-factory-daemon-'));
  const bin = join(home, 'bin');
  const repo = join(home, 'repo');
  const configHome = join(home, 'config');
  mkdirSync(bin);
  if (options.connected !== false) {
    writeCredential(configHome);
  }
  writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'claude'), 0o755);
  mkdirSync(join(repo, '.factory', 'lines'), { recursive: true });
  writeFileSync(
    join(repo, '.factory', 'config.json'),
    JSON.stringify({ project: 'software-factory' }),
  );
  writeFileSync(join(repo, '.factory', 'lines', 'feature.yml'), FEATURE_LINE);
  const port = await freePort();
  const result: Sandbox = {
    repo,
    dataDir: join(home, 'data', 'sf'),
    port,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: home,
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: join(home, 'data'),
      SF_FACTORY_PORT: String(port),
      FACTORY_URL: factoryUrl,
      FACTORY_TOKEN: TOKEN,
    },
  };
  sandboxes.push(result);
  return result;
};

const runSf = (
  env: Record<string, string>,
  args: readonly string[],
): Promise<CliResult> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: env.HOME,
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), COMMAND_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? -1, stdout, stderr });
    });
  });

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitUntilGone = async (pids: readonly number[]): Promise<boolean> => {
  const deadline = Date.now() + EXIT_WAIT_MS;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isAlive(pid))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return pids.every((pid) => !isAlive(pid));
};

const startDaemon = async (env: Record<string, string>): Promise<number> => {
  const result = await runSf(env, ['factory', 'start', '--json']);
  expect(result.status).toBe(EXIT.ok);
  return (JSON.parse(result.stdout) as { pid: number }).pid;
};

const stopDaemon = (env: Record<string, string>): Promise<CliResult> =>
  runSf(env, ['factory', 'stop']);

beforeAll(async () => {
  factory = createServer((request, response) => {
    if (request.method === 'GET' && request.url === PROJECTS_ROUTE) {
      replyJson(200, PROJECTS_REPLY, response);
      return;
    }
    if (request.method === 'POST' && request.url === TOKENS_ROUTE) {
      replyJson(
        201,
        {
          code: 201,
          tokenId: 'tok-1',
          kind: 'cell_join',
          token: 'sf_cell_join_stub',
          scopes: [],
          expiresAt: null,
        },
        response,
      );
      return;
    }
    if (request.method === 'POST' && request.url === ENROLL_ROUTE) {
      replyJson(
        201,
        {
          code: 201,
          cellId: 'cell-stub',
          sessionToken: 'sf_cell_session_stub',
          expiresAt: 4_102_444_800_000,
        },
        response,
      );
      return;
    }
    if (request.method === 'POST' && request.url === HELLO_ROUTE) {
      replyJson(200, { code: 200, cellId: 'cell-stub' }, response);
      return;
    }
    if (request.method === 'POST' && request.url === HEARTBEAT_ROUTE) {
      replyJson(200, { code: 200, factoryId: FACTORY_ID }, response);
      return;
    }
    if (request.method === 'POST' && request.url === CLAIMS_ROUTE) {
      setTimeout(() => {
        replyJson(200, { code: 200, job: null, signals: [] }, response);
      }, 1_000);
      return;
    }
    replyJson(404, { code: 404, message: 'not stubbed' }, response);
  });
  await new Promise<void>((resolve) => {
    factory.listen(0, '127.0.0.1', () => resolve());
  });
  const address = factory.address();
  if (address === null || typeof address === 'string') {
    throw new Error('factory stub did not bind');
  }
  factoryUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const { env } of sandboxes) {
    await stopDaemon(env);
  }
  await new Promise<void>((resolve) => factory.close(() => resolve()));
  for (const { env } of sandboxes) {
    rmSync(env.HOME, { recursive: true, force: true });
  }
});

describe('factory daemon lifecycle', () => {
  it(
    'second start refuses and names the running pid',
    async () => {
      // Arrange
      const { env } = await sandbox();
      const pid = await startDaemon(env);

      // Act
      const second = await runSf(env, ['factory', 'start']);

      // Assert
      expect(second.status).toBe(EXIT.refused);
      expect(second.stderr).toContain(`factory already running, pid ${pid}`);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'status ignores a foreign listener on the port',
    async () => {
      // Arrange
      const { env, port } = await sandbox();
      const foreign = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('not a factory');
      });
      await new Promise<void>((resolve) =>
        foreign.listen(port, '127.0.0.1', () => resolve()),
      );

      try {
        // Act
        const status = await runSf(env, ['factory', 'status', '--json']);
        const start = await runSf(env, ['factory', 'start']);

        // Assert
        expect(status.status).toBe(EXIT.refused);
        expect(JSON.parse(status.stdout)).toEqual({
          running: false,
          healthy: false,
          pid: null,
          daemon: null,
        });
        expect(start.status).toBe(EXIT.refused);
        expect(start.stderr).toContain(`port ${port} is in use`);
      } finally {
        await new Promise<void>((resolve) => foreign.close(() => resolve()));
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'daemon listens on loopback only',
    async () => {
      // Arrange
      const { env, port } = await sandbox();
      await startDaemon(env);

      // Act
      const listeners = spawnSync('ss', ['-ltn'], { encoding: 'utf8' }).stdout;
      const publicBind = new RegExp(`(0\\.0\\.0\\.0|\\*|\\[::\\]):${port}\\b`);

      // Assert
      expect(listeners).toContain(`127.0.0.1:${port}`);
      expect(publicBind.test(listeners)).toBe(false);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stop ends the daemon and its Cells',
    async () => {
      // Arrange
      const { env, repo, dataDir } = await sandbox();
      await startDaemon(env);
      const created = await runSf(env, [
        'cell',
        'create',
        '--repo',
        repo,
        '--count',
        '2',
        '--json',
      ]);
      const cells = JSON.parse(created.stdout) as CreatedCell[];
      const pids = cells.map((cell) => cell.pid);
      const daemonPid = Number(
        readFileSync(join(dataDir, 'factory.pid'), 'utf8'),
      );

      // Act
      const aliveBefore = pids.map(isAlive);
      const stopped = await stopDaemon(env);
      const status = await runSf(env, ['factory', 'status']);

      // Assert
      expect(created.status).toBe(EXIT.ok);
      expect(aliveBefore).toEqual(pids.map(() => true));
      expect(stopped.stdout.trim()).toBe('factory stopped');
      expect(status.status).toBe(EXIT.refused);
      expect(isAlive(daemonPid)).toBe(false);
      expect(await waitUntilGone(pids)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'killing the daemon leaves no Cell running',
    async () => {
      // Arrange
      const { env, repo, dataDir } = await sandbox();
      await startDaemon(env);
      const created = await runSf(env, [
        'cell',
        'create',
        '--repo',
        repo,
        '--count',
        '2',
        '--json',
      ]);
      const pids = (JSON.parse(created.stdout) as CreatedCell[]).map(
        (cell) => cell.pid,
      );
      const daemonPid = Number(
        readFileSync(join(dataDir, 'factory.pid'), 'utf8'),
      );

      // Act
      process.kill(daemonPid, 'SIGKILL');

      // Assert
      expect(await waitUntilGone(pids)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'cell create without a daemon fails with the start hint',
    async () => {
      // Arrange
      const { env, repo } = await sandbox();

      // Act
      const result = await runSf(env, ['cell', 'create', '--repo', repo]);

      // Assert
      expect(result.status).toBe(EXIT.unreachable);
      expect(result.stderr).toContain(
        'factory not running: run "sf factory start"',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'cell create is refused while the factory is not connected',
    async () => {
      // Arrange
      const { env, repo } = await sandbox({ connected: false });
      await startDaemon(env);

      // Act
      const result = await runSf(env, ['cell', 'create', '--repo', repo]);

      // Assert
      expect(result.status).toBe(EXIT.refused);
      expect(result.stderr).toContain('factory not connected');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'status shows the HQ link and never the credential token',
    async () => {
      // Arrange
      const { env } = await sandbox();
      await startDaemon(env);

      // Act
      const status = await runSf(env, ['factory', 'status']);

      // Assert
      expect(status.status).toBe(EXIT.ok);
      expect(status.stdout).toContain(`factoryId ${FACTORY_ID}`);
      expect(status.stdout).toContain('hq: ok');
      expect(status.stdout).not.toContain(FACTORY_SESSION);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'cell list, stop and rm act on the daemon cells',
    async () => {
      // Arrange
      const { env, repo } = await sandbox();
      await startDaemon(env);
      const created = await runSf(env, [
        'cell',
        'create',
        '--repo',
        repo,
        '--json',
      ]);
      const [cell] = JSON.parse(created.stdout) as CreatedCell[];

      // Act
      const listed = await runSf(env, ['cell', 'list', '--here', '--json']);
      const stopped = await runSf(env, ['cell', 'stop', cell?.cellId ?? '']);
      const afterStop = await runSf(env, ['cell', 'list', '--here', '--json']);
      const removed = await runSf(env, ['cell', 'rm', cell?.cellId ?? '']);

      // Assert
      expect(JSON.parse(listed.stdout)).toEqual([
        expect.objectContaining({ cellId: cell?.cellId, pid: cell?.pid }),
      ]);
      expect(stopped.stdout.trim()).toBe(`cell ${cell?.cellId} stopped`);
      expect(JSON.parse(afterStop.stdout)).toEqual([]);
      expect(removed.status).toBe(EXIT.refused);
      expect(removed.stderr).toContain(`no cell ${cell?.cellId}`);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it('refuses a fixed name for more than one cell', async () => {
    // Arrange
    const { env, repo } = await sandbox();

    // Act
    const result = await runSf(env, [
      'cell',
      'create',
      '--repo',
      repo,
      '--count',
      '2',
      '--name',
      'shared',
    ]);

    // Assert
    expect(result.status).toBe(EXIT.argument);
    expect(result.stderr).toContain('name is only allowed with count 1');
  });
});
