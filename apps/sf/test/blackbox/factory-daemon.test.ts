import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellNameOf } from '../../src/domain/cell/cell-name';
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
const GONE_ROUTE = /^\/api\/v1\/factories\/cells\/([^/]+)\/gone$/;
const FACTORY_ID = 'factory-stub';
const FACTORY_SESSION = 'sf_factory_session_stub';
const START_WAIT_MS = 20_000;
const HQ_SESSION_PREFIX = 'sf_cell_session_';
const NEVER_EXPIRES_MS = 4_102_444_800_000;

const sandboxes: Sandbox[] = [];
let factory: Server;
let factoryUrl: string;
let sessionCount = 0;
let goneFailing = false;
const hqCalls: HqCall[] = [];
const goneCalls: GoneCall[] = [];
const helloRejections = new Map<string, number>();

interface HqCall {
  route: 'enroll' | 'hello';
  projectId: string;
  name: string | undefined;
  bearer: string;
}

interface GoneCall {
  cellId: string;
  bearer: string;
}

interface Sandbox {
  env: Record<string, string>;
  repo: string;
  dataDir: string;
  port: number;
  project: string;
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
  const project = `relay-project-${sandboxes.length + 1}`;
  mkdirSync(join(repo, '.factory', 'lines'), { recursive: true });
  writeFileSync(
    join(repo, '.factory', 'config.json'),
    JSON.stringify({ project }),
  );
  writeFileSync(join(repo, '.factory', 'lines', 'feature.yml'), FEATURE_LINE);
  const port = await freePort();
  const result: Sandbox = {
    repo,
    project,
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
  cwd: string = env.HOME,
): Promise<CliResult> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
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

const scaleTo = (
  env: Record<string, string>,
  repo: string,
  count: number,
): Promise<CliResult> =>
  runSf(env, ['cell', 'scale', String(count), '--json'], repo);

const cellsOf = async (env: Record<string, string>): Promise<CreatedCell[]> => {
  const listed = await runSf(env, ['cell', 'list', '--json']);
  const projects = JSON.parse(listed.stdout) as { cells: CreatedCell[] }[];
  return projects.flatMap((project) => project.cells);
};

const bodyOf = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (text += chunk));
    request.on('end', () => resolve(text));
  });

const bearerOf = (request: IncomingMessage): string =>
  (request.headers.authorization ?? '').replace('Bearer ', '');

interface CellBody {
  projectId: string;
  name?: string;
}

const cellBodyOf = async (request: IncomingMessage): Promise<CellBody> =>
  JSON.parse(await bodyOf(request)) as CellBody;

const answerEnroll = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const body = await cellBodyOf(request);
  hqCalls.push({
    route: 'enroll',
    projectId: body.projectId,
    name: body.name,
    bearer: bearerOf(request),
  });
  sessionCount += 1;
  replyJson(
    201,
    {
      code: 201,
      cellId: `${body.projectId}:${body.name ?? ''}`,
      sessionToken: `${HQ_SESSION_PREFIX}${sessionCount}`,
      expiresAt: NEVER_EXPIRES_MS,
    },
    response,
  );
};

const answerHello = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const body = await cellBodyOf(request);
  hqCalls.push({
    route: 'hello',
    projectId: body.projectId,
    name: undefined,
    bearer: bearerOf(request),
  });
  const rejections = helloRejections.get(body.projectId) ?? 0;
  if (rejections > 0) {
    helloRejections.set(body.projectId, rejections - 1);
    replyJson(401, { code: 401, message: 'session expired' }, response);
    return;
  }
  replyJson(200, { code: 200, cellId: body.projectId }, response);
};

const answerGone = (
  request: IncomingMessage,
  response: ServerResponse,
): void => {
  const cellId = decodeURIComponent(
    GONE_ROUTE.exec(request.url ?? '')?.[1] ?? '',
  );
  goneCalls.push({ cellId, bearer: bearerOf(request) });
  if (goneFailing) {
    replyJson(503, { code: 503, message: 'HQ down' }, response);
    return;
  }
  replyJson(200, { code: 200, cellId }, response);
};

const goneCallsOf = (projectId: string): GoneCall[] =>
  goneCalls.filter((call) => call.cellId.startsWith(`${projectId}:`));

const projectOf = (projectId: string) => ({
  projectId,
  repoUrl: `https://example.test/${projectId}.git`,
  defaultBaseBranch: 'main',
  maxRunning: 5,
  createdAt: 1,
  updatedAt: 1,
});

const hqCallsOf = (projectId: string, route: HqCall['route']): HqCall[] =>
  hqCalls.filter(
    (call) => call.projectId === projectId && call.route === route,
  );

const relayUrlOf = (port: number): string => `http://127.0.0.1:${port}/relay`;

const cellEnvOf = (pid: number): Record<string, string> =>
  Object.fromEntries(
    readFileSync(`/proc/${pid}/environ`, 'utf8')
      .split('\0')
      .filter((entry) => entry.includes('='))
      .map((entry) => {
        const index = entry.indexOf('=');
        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
  );

const waitFor = async (check: () => boolean): Promise<boolean> => {
  const deadline = Date.now() + START_WAIT_MS;
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return check();
};

beforeAll(async () => {
  factory = createServer((request, response) => {
    if (request.method === 'GET' && request.url === PROJECTS_ROUTE) {
      replyJson(
        200,
        {
          ...PROJECTS_REPLY,
          projects: [
            ...PROJECTS_REPLY.projects,
            ...sandboxes.map(({ project }) => projectOf(project)),
          ],
        },
        response,
      );
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
      void answerEnroll(request, response);
      return;
    }
    if (request.method === 'POST' && request.url === HELLO_ROUTE) {
      void answerHello(request, response);
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
    if (request.method === 'POST' && GONE_ROUTE.test(request.url ?? '')) {
      answerGone(request, response);
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
      const created = await scaleTo(env, repo, 2);
      const pids = (await cellsOf(env)).map((cell) => cell.pid);
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
      await scaleTo(env, repo, 2);
      const pids = (await cellsOf(env)).map((cell) => cell.pid);
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
    'cell scale without a daemon fails with the start hint',
    async () => {
      // Arrange
      const { env, repo } = await sandbox();

      // Act
      const result = await runSf(env, ['cell', 'scale', '1'], repo);

      // Assert
      expect(result.status).toBe(EXIT.unreachable);
      expect(result.stderr).toContain(
        'factory not running: run "sf factory start"',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'cell scale is refused while the factory is not connected',
    async () => {
      // Arrange
      const { env, repo } = await sandbox({ connected: false });
      await startDaemon(env);

      // Act
      const result = await runSf(env, ['cell', 'scale', '1'], repo);

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
    'cell list shows the project and scale to zero clears it',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      await startDaemon(env);
      const scaled = await scaleTo(env, repo, 1);
      const [cell] = await cellsOf(env);

      // Act
      const listed = await runSf(env, ['cell', 'list', '--json']);
      const stopped = await scaleTo(env, repo, 0);
      const afterStop = await runSf(env, ['cell', 'list', '--json']);

      // Assert
      expect(scaled.status).toBe(EXIT.ok);
      expect(JSON.parse(listed.stdout)).toEqual([
        expect.objectContaining({
          projectId: project,
          repoRoot: repo,
          desired: 1,
          running: 1,
          cells: [
            expect.objectContaining({
              cellId: cell?.cellId,
              pid: cell?.pid,
              state: 'idle',
            }),
          ],
        }),
      ]);
      expect(stopped.status).toBe(EXIT.ok);
      expect(await waitFor(() => !isAlive(cell?.pid ?? 0))).toBe(true);
      expect(JSON.parse(afterStop.stdout)).toEqual([]);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('factory gone calls', () => {
  it(
    'scale to zero calls HQ gone for the cell after its process is dead',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      await startDaemon(env);
      await scaleTo(env, repo, 1);
      const [cell] = await cellsOf(env);
      await waitFor(() => hqCallsOf(project, 'enroll').length >= 1);
      const hqName = hqCallsOf(project, 'enroll')[0]?.name ?? '';

      // Act
      const stopped = await scaleTo(env, repo, 0);

      // Assert
      expect(stopped.status).toBe(EXIT.ok);
      expect(await waitFor(() => !isAlive(cell?.pid ?? 0))).toBe(true);
      expect(goneCallsOf(project)).toEqual([
        { cellId: `${project}:${hqName}`, bearer: FACTORY_SESSION },
      ]);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'scale to zero still ends the cell when HQ refuses the gone call',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      await startDaemon(env);
      await scaleTo(env, repo, 1);
      const [cell] = await cellsOf(env);
      await waitFor(() => hqCallsOf(project, 'enroll').length >= 1);

      // Act
      goneFailing = true;
      let stopped: CliResult;
      try {
        stopped = await scaleTo(env, repo, 0);
      } finally {
        goneFailing = false;
      }

      // Assert
      expect(stopped.status).toBe(EXIT.ok);
      expect(await waitFor(() => !isAlive(cell?.pid ?? 0))).toBe(true);
      expect(goneCallsOf(project)).toHaveLength(1);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('factory relay', () => {
  it(
    'relayed cell env has no HQ url or token',
    async () => {
      // Arrange
      const { env, repo, port } = await sandbox();
      await startDaemon(env);
      const created = await scaleTo(env, repo, 1);
      expect(created.stderr).toBe('');
      const [cell] = await cellsOf(env);

      // Act
      const cellEnv = cellEnvOf(cell?.pid ?? 0);
      const values = Object.values(cellEnv);

      // Assert
      expect(created.status).toBe(EXIT.ok);
      expect(cellEnv.FACTORY_URL).toBe(relayUrlOf(port));
      expect(values).not.toContain(factoryUrl);
      expect(values).not.toContain(TOKEN);
      expect(values).not.toContain(FACTORY_SESSION);
      expect(cellEnv.FACTORY_JOIN_TOKEN ?? '').toBe('');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'relay refuses routes outside the cell allowlist with 403',
    async () => {
      // Arrange
      const { env, port } = await sandbox();
      await startDaemon(env);

      // Act
      const response = await fetch(`${relayUrlOf(port)}/api/v1/projects`);

      // Assert
      expect(response.status).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'upstream 401 re-enrolls once and retries',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      helloRejections.set(project, 1);
      await startDaemon(env);

      // Act
      await scaleTo(env, repo, 1);
      const retried = await waitFor(
        () => hqCallsOf(project, 'hello').length >= 2,
      );

      // Assert
      const enrolls = hqCallsOf(project, 'enroll');
      expect(retried).toBe(true);
      expect(enrolls).toHaveLength(2);
      expect(enrolls[1]?.name).toBe(enrolls[0]?.name);
      expect(enrolls[0]?.bearer).toBe(FACTORY_SESSION);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'second upstream 401 kills the cell',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      helloRejections.set(project, 2);
      await startDaemon(env);
      await scaleTo(env, repo, 1);
      const [cell] = await cellsOf(env);

      // Act
      const gone = await waitFor(() => !isAlive(cell?.pid ?? 0));
      const listed = await runSf(env, ['cell', 'list', '--json']);

      // Assert
      const listedIds = (
        JSON.parse(listed.stdout) as { cells: CreatedCell[] }[]
      ).flatMap((item) => item.cells.map((killed) => killed.cellId));
      expect(gone).toBe(true);
      expect(hqCallsOf(project, 'enroll').length).toBeGreaterThanOrEqual(2);
      expect(hqCallsOf(project, 'hello').length).toBeGreaterThanOrEqual(2);
      expect(listedIds).not.toContain(cell?.cellId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'local token stops working after the cell exits',
    async () => {
      // Arrange
      const { env, repo, port, project } = await sandbox();
      await startDaemon(env);
      await scaleTo(env, repo, 1);
      const [cell] = await cellsOf(env);
      const localToken = cellEnvOf(cell?.pid ?? 0).FACTORY_TOKEN ?? '';
      await waitFor(() => hqCallsOf(project, 'hello').length >= 1);

      // Act
      await scaleTo(env, repo, 0);
      const gone = await waitFor(() => !isAlive(cell?.pid ?? 0));
      const after = await fetch(`${relayUrlOf(port)}/api/v1/cells/hello`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${localToken}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });

      // Assert
      expect(gone).toBe(true);
      expect(after.status).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'cell start never reads a stale session file',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      const name = cellNameOf(hostname());
      mkdirSync(join(repo, '.factory-local', 'cells'), { recursive: true });
      writeFileSync(
        join(repo, '.factory-local', 'cells', `${name}.json`),
        JSON.stringify({ cellId: 'stale-cell', sessionToken: 'sf_stale' }),
      );
      await startDaemon(env);

      // Act
      await scaleTo(env, repo, 1);
      const [cell] = await cellsOf(env);
      const helloed = await waitFor(
        () => hqCallsOf(project, 'hello').length >= 1,
      );

      // Assert
      expect(helloed).toBe(true);
      expect(hqCallsOf(project, 'enroll')).toHaveLength(1);
      expect(hqCallsOf(project, 'hello')[0]?.bearer).toMatch(
        /^sf_cell_session_/,
      );
      expect(isAlive(cell?.pid ?? 0)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
