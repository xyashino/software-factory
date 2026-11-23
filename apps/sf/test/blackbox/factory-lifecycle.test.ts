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
const CLAIMS_ROUTE = '/api/v1/cells/claims';
const TOKENS_ROUTE = '/api/v1/tokens';
const HEARTBEAT_ROUTE = '/api/v1/factories/heartbeat';
const GONE_ROUTE = /^\/api\/v1\/factories\/cells\/([^/]+)\/gone$/;
const FACTORY_ID = 'factory-stub';
const FACTORY_SESSION = 'sf_factory_session_stub';
const START_WAIT_MS = 20_000;
const RESPAWN_WAIT_MS = 3_000;

const sandboxes: Sandbox[] = [];
let factory: Server;
let factoryUrl: string;
let goneFailing = false;
const claimRejected = new Set<string>();
const claimCalls: ClaimCall[] = [];
const goneCalls: GoneCall[] = [];
const heartbeatProjects: HeartbeatCall[] = [];

interface ClaimCall {
  cellId: string;
  bearer: string;
  body: ClaimBody;
}

interface ClaimBody {
  projectId: string;
  allowedLines: string[];
  runners: string[];
}

interface HeartbeatCall {
  projects: { projectId: string; desired: number; running: number }[];
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
  projectId: string;
  pid: number;
}

interface ProjectRow {
  projectId: string;
  repoRoot: string;
  desired: number;
  running: number;
  crashLoop: boolean;
  cells: { cellId: string; name: string; pid: number; state: string }[];
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

const bodyOf = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (text += chunk));
    request.on('end', () => resolve(text));
  });

const bearerOf = (request: IncomingMessage): string =>
  (request.headers.authorization ?? '').replace('Bearer ', '');

const cellIdOf = (request: IncomingMessage): string =>
  String(request.headers['x-cell-id'] ?? '');

const answerClaim = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const cellId = cellIdOf(request);
  const body = JSON.parse(await bodyOf(request)) as ClaimBody;
  claimCalls.push({ cellId, bearer: bearerOf(request), body });
  if (claimRejected.has(cellId)) {
    replyJson(
      401,
      { code: 401, message: 'factory credential rejected' },
      response,
    );
    return;
  }
  setTimeout(() => {
    replyJson(200, { code: 200, job: null, signals: [] }, response);
  }, 1_000);
};

const answerHeartbeat = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const body = JSON.parse(await bodyOf(request)) as HeartbeatCall;
  heartbeatProjects.push(body);
  replyJson(200, { code: 200, factoryId: FACTORY_ID }, response);
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

const projectOf = (projectId: string) => ({
  projectId,
  repoUrl: `https://example.test/${projectId}.git`,
  defaultBaseBranch: 'main',
  maxRunning: 5,
  createdAt: 1,
  updatedAt: 1,
});

const claimsOf = (cellId: string): ClaimCall[] =>
  claimCalls.filter((call) => call.cellId === cellId);

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

const cellsOf = async (
  env: Record<string, string>,
  repo: string,
): Promise<CreatedCell[]> => {
  const listed = await runSf(env, ['cell', 'list', '--json']);
  const projects = JSON.parse(listed.stdout) as ProjectRow[];
  return projects
    .filter((row) => row.repoRoot === repo)
    .flatMap((row) =>
      row.cells.map((cell) => ({
        cellId: cell.cellId,
        name: cell.name,
        projectId: row.projectId,
        pid: cell.pid,
      })),
    );
};

const scaleTo = async (
  env: Record<string, string>,
  repo: string,
  count: number,
): Promise<CreatedCell[]> => {
  const scaled = await runSf(env, [
    'cell',
    'scale',
    String(count),
    '--repo',
    repo,
  ]);
  expect(scaled.status).toBe(EXIT.ok);
  return cellsOf(env, repo);
};

const createCell = async (
  env: Record<string, string>,
  repo: string,
): Promise<CreatedCell> => {
  const [cell] = await scaleTo(env, repo, 1);
  if (cell === undefined) throw new Error('no cell created');
  return cell;
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
          kind: 'factory_join',
          token: 'sf_join_stub',
          scopes: [],
          expiresAt: null,
        },
        response,
      );
      return;
    }
    if (request.method === 'POST' && request.url === CLAIMS_ROUTE) {
      void answerClaim(request, response);
      return;
    }
    if (request.method === 'POST' && request.url === HEARTBEAT_ROUTE) {
      void answerHeartbeat(request, response);
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
      const cells = await scaleTo(env, repo, 2);
      const pids = cells.map((cell) => cell.pid);
      const daemonPid = Number(
        readFileSync(join(dataDir, 'factory.pid'), 'utf8'),
      );

      // Act
      const aliveBefore = pids.map(isAlive);
      const stopped = await stopDaemon(env);
      const status = await runSf(env, ['factory', 'status']);

      // Assert
      expect(cells).toHaveLength(2);
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
      const pids = (await scaleTo(env, repo, 2)).map((cell) => cell.pid);
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
      const result = await runSf(env, ['cell', 'scale', '1', '--repo', repo]);

      // Assert
      expect(result.status).toBe(EXIT.unreachable);
      expect(result.stderr).toContain(
        'factory not running: run "sf factory start"',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'cell scale up is refused while the factory is not connected',
    async () => {
      // Arrange
      const { env, repo } = await sandbox({ connected: false });
      await startDaemon(env);

      // Act
      const result = await runSf(env, ['cell', 'scale', '1', '--repo', repo]);

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
    'cell list shows the project desired count and its cells, scale down empties it',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      await startDaemon(env);
      const cell = await createCell(env, repo);

      // Act
      const listed = await runSf(env, ['cell', 'list', '--json']);
      const scaled = await runSf(env, ['cell', 'scale', '0', '--repo', repo]);
      const afterScale = await runSf(env, ['cell', 'list', '--json']);

      // Assert
      expect(JSON.parse(listed.stdout)).toEqual([
        expect.objectContaining({
          projectId: project,
          desired: 1,
          running: 1,
          cells: [expect.objectContaining({ cellId: cell.cellId })],
        }),
      ]);
      expect(scaled.stdout.trim()).toBe(`project ${project} scaled to 0`);
      expect(JSON.parse(afterScale.stdout)).toEqual([
        expect.objectContaining({ desired: 0, running: 0, cells: [] }),
      ]);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it('cell stop and rm are removed and point to cell scale', async () => {
    // Arrange
    const { env } = await sandbox();

    // Act
    const stop = await runSf(env, ['cell', 'stop', 'cell-00000000']);
    const remove = await runSf(env, ['cell', 'rm', 'cell-00000000']);

    // Assert
    expect(stop.status).toBe(EXIT.argument);
    expect(stop.stderr).toContain('use "sf cell scale N"');
    expect(remove.status).toBe(EXIT.argument);
    expect(remove.stderr).toContain('use "sf cell scale N"');
  });
});

describe('factory gone calls', () => {
  it(
    'scale down calls HQ gone for the cell after its process is dead',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      await startDaemon(env);
      const cell = await createCell(env, repo);
      await waitFor(() => claimsOf(cell.cellId).length >= 1);

      // Act
      const stopped = await runSf(env, ['cell', 'scale', '0', '--repo', repo]);

      // Assert
      expect(stopped.stdout.trim()).toBe(`project ${project} scaled to 0`);
      expect(await waitFor(() => !isAlive(cell.pid))).toBe(true);
      expect(goneCalls.filter((call) => call.cellId === cell.cellId)).toEqual([
        { cellId: cell.cellId, bearer: FACTORY_SESSION },
      ]);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'scale down still ends the cell when HQ refuses the gone call',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      await startDaemon(env);
      const cell = await createCell(env, repo);
      await waitFor(() => claimsOf(cell.cellId).length >= 1);

      // Act
      goneFailing = true;
      let stopped: CliResult;
      try {
        stopped = await runSf(env, ['cell', 'scale', '0', '--repo', repo]);
      } finally {
        goneFailing = false;
      }

      // Assert
      expect(stopped.status).toBe(EXIT.ok);
      expect(stopped.stdout.trim()).toBe(`project ${project} scaled to 0`);
      expect(await waitFor(() => !isAlive(cell.pid))).toBe(true);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('factory relay', () => {
  it(
    'relayed cell env carries its id and the local token, never the HQ url or credential',
    async () => {
      // Arrange
      const { env, repo, port } = await sandbox();
      await startDaemon(env);

      // Act
      const cell = await createCell(env, repo);
      const cellEnv = cellEnvOf(cell.pid);
      const values = Object.values(cellEnv);

      // Assert
      expect(cellEnv.HQ_URL).toBe(relayUrlOf(port));
      expect(cellEnv.FACTORY_CELL_ID).toBe(cell.cellId);
      expect(values).not.toContain(factoryUrl);
      expect(values).not.toContain(TOKEN);
      expect(values).not.toContain(FACTORY_SESSION);
      expect(cell.cellId).toMatch(/^cell-[0-9a-f]{8}$/);
      await stopDaemon(env);
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
      const projects = await fetch(`${relayUrlOf(port)}/api/v1/projects`);
      const enroll = await fetch(`${relayUrlOf(port)}/api/v1/cells/enroll`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}` },
        body: '{}',
      });

      // Assert
      expect(projects.status).toBe(403);
      expect(enroll.status).toBe(403);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a claim through the relay carries the factory credential and the cell id',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      await startDaemon(env);

      // Act
      const cell = await createCell(env, repo);
      const claimed = await waitFor(() => claimsOf(cell.cellId).length >= 1);

      // Assert
      expect(claimed).toBe(true);
      expect(claimsOf(cell.cellId)[0]).toMatchObject({
        cellId: cell.cellId,
        bearer: FACTORY_SESSION,
        body: {
          projectId: project,
          runners: expect.arrayContaining(['claude']),
        },
      });
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a factory credential rejected by HQ ends the cell and the daemon respawns it',
    async () => {
      // Arrange
      const { env, repo } = await sandbox();
      await startDaemon(env);
      const cell = await createCell(env, repo);
      claimRejected.add(cell.cellId);

      // Act
      const gone = await waitFor(() => !isAlive(cell.pid));
      await new Promise((resolve) => setTimeout(resolve, RESPAWN_WAIT_MS));
      const respawned = await cellsOf(env, repo);

      // Assert
      expect(gone).toBe(true);
      expect(respawned).toHaveLength(1);
      expect(respawned[0]?.cellId).not.toBe(cell.cellId);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'local token stops working after the cell exits',
    async () => {
      // Arrange
      const { env, repo, port } = await sandbox();
      await startDaemon(env);
      const cell = await createCell(env, repo);
      const localToken = cellEnvOf(cell.pid).HQ_TOKEN ?? '';
      await waitFor(() => claimsOf(cell.cellId).length >= 1);

      // Act
      await runSf(env, ['cell', 'scale', '0', '--repo', repo]);
      const gone = await waitFor(() => !isAlive(cell.pid));
      const after = await fetch(`${relayUrlOf(port)}/api/v1/cells/claims`, {
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
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'the daemon reports each project it runs cells for in its heartbeat',
    async () => {
      // Arrange
      const { env, repo, project } = await sandbox();
      await startDaemon(env);

      // Act
      await createCell(env, repo);
      const reported = await waitFor(() =>
        heartbeatProjects.some((beat) =>
          beat.projects.some(
            (row) =>
              row.projectId === project &&
              row.desired === 1 &&
              row.running === 1,
          ),
        ),
      );

      // Assert
      expect(reported).toBe(true);
      await stopDaemon(env);
    },
    TEST_TIMEOUT_MS,
  );
});
