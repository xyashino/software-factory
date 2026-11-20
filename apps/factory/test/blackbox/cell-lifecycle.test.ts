import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Refused, Unreachable } from '../../src/application/core/errors';
import type { Ports } from '../../src/application/core/procedure';
import type { ClaimedJob } from '../../src/application/procedures/cell/cell-runtime';
import { listCells } from '../../src/application/procedures/cell/list.procedure';
import { startCell } from '../../src/application/procedures/cell/start.procedure';
import type {
  CellSession,
  CellStatePort,
} from '../../src/application/ports/cell-state.port';
import type { ClockPort } from '../../src/application/ports/clock.port';
import type {
  RunHandle,
  RunOutcome,
  RunSpec,
} from '../../src/application/ports/runner.port';
import { CLAIM_WAIT_MS, HEARTBEAT_INTERVAL_MS } from '../../src/config';
import { commandIdOf } from '../../src/domain/cell/command-id';
import { EXIT } from '../../src/domain/exit-codes';
import {
  createFakePorts,
  runProcedure,
  type ServerCall,
} from '../support/fake-ports';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;

const REPO = '/repo';
const PROJECT = 'software-factory';
const CELL_ID = 'software-factory-dev-box';
const SESSION_TOKEN = 'sf_cell_stub_session';
const JOIN_TOKEN = 'join-stub-value';
const OPERATOR_URL = 'http://127.0.0.1:9/';
const ENROLL_ROUTE = '/api/v1/cells/enroll';
const HELLO_ROUTE = '/api/v1/cells/hello';
const CLAIMS_ROUTE = '/api/v1/cells/claims';
const HEARTBEATS_ROUTE = '/api/v1/cells/heartbeats';
const CELLS_ROUTE = '/api/v1/cells';
const RUNNER = 'claude';
const INSTALLED_RUNNERS = [RUNNER, 'codex'];
const FEATURE_LINE = [
  'name: feature',
  'stations:',
  '  - id: plan',
  '    kind: operator',
  '    runner: claude',
  '  - id: build',
  '    kind: operator',
  '    runner: claude',
  '    onFail:',
  '      retry: build',
  '      max: 3',
  '',
].join('\n');

const EXIT_REVOKE_REFUSED = EXIT.argument;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface StubServer {
  url: string;
  hits: { method: string | undefined }[];
  server: Server;
}

interface Scenario {
  claims: (ClaimedJob | null)[];
  uninstalled?: string[];
  files?: Record<string, string>;
  session?: CellSession | null;
  joinToken?: string;
  failStartOnce?: boolean;
  resetJob?: ClaimedJob;
}

const job = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  jobId: 'job-1',
  kind: 'operator',
  orderId: 'software-factory:cli-08',
  planId: null,
  stepId: 'build',
  workspaceMode: 'fresh',
  epoch: 7,
  leaseExpiresAt: 1,
  repoUrl: 'git@example.test:software-factory.git',
  baseBranch: 'main',
  baseCommitSha: null,
  targetBranch: 'factory/cli-08',
  expectedPriorSteps: [],
  payload: { lineName: 'feature' },
  ...overrides,
});

const baseFiles = (): Record<string, string> => ({
  [join(REPO, '.factory', 'config.json')]: JSON.stringify({ project: PROJECT }),
  [join(REPO, '.factory', 'lines', 'feature.yml')]: FEATURE_LINE,
});

const actionOf = (body: unknown): string =>
  typeof body === 'object' &&
  body !== null &&
  'action' in body &&
  typeof body.action === 'string'
    ? body.action
    : '';

const bodyOf = (call: ServerCall): Record<string, unknown> =>
  typeof call.body === 'object' && call.body !== null
    ? (call.body as Record<string, unknown>)
    : {};

const transitionCalls = (calls: ServerCall[]): ServerCall[] =>
  calls.filter((call) => call.route.endsWith('/transitions'));

const actionsOf = (calls: ServerCall[]): string[] =>
  transitionCalls(calls).map((call) => actionOf(call.body));

const NOOP_GIT: Ports['git'] = {
  currentBranch: async () => 'main',
  isClean: async () => true,
  worktreeAdd: async () => undefined,
  worktreeRemove: async () => undefined,
  excludeLocally: async () => undefined,
  commit: async () => undefined,
  push: async () => undefined,
  headSha: async () => 'abc123',
  status: async () => '',
};

const memoryFs = (files: Record<string, string>): Ports['fs'] => ({
  readText: async (path) => {
    const text = files[path];
    if (text === undefined) {
      throw new Error(`ENOENT ${path}`);
    }
    return text;
  },
  writeText: async (path, text) => {
    files[path] = text;
  },
  exists: async (path) => path in files,
  list: async (dir) =>
    Object.keys(files)
      .filter((path) => dirname(path) === dir)
      .map((path) => basename(path)),
  appendText: async (path, text) => {
    files[path] = (files[path] ?? '') + text;
  },
  readStdin: async () => '',
});

const memoryCellState = (initial: CellSession | null) => {
  let stored = initial;
  const writes: CellSession[] = [];
  const port: CellStatePort = {
    read: async () => stored,
    write: async (session) => {
      writes.push(session);
      stored = session;
    },
  };
  return { port, writes };
};

const testClock: ClockPort = {
  now: () => 0,
  sleep: (ms) =>
    ms === HEARTBEAT_INTERVAL_MS
      ? new Promise<void>(() => undefined)
      : Promise.resolve(),
};

const serverReplies = (
  scenario: Scenario,
  stop: () => void,
): ((call: ServerCall) => unknown) => {
  const queue = [...scenario.claims];
  const resetJob =
    scenario.resetJob ?? job({ epoch: 8, expectedPriorSteps: [] });
  let startFailures = 0;
  return (call) => {
    if (call.route === ENROLL_ROUTE) {
      return {
        code: 201,
        cellId: CELL_ID,
        sessionToken: SESSION_TOKEN,
        expiresAt: 1,
      };
    }
    if (call.route === HELLO_ROUTE) {
      return { code: 200, cellId: CELL_ID };
    }
    if (call.route === CLAIMS_ROUTE) {
      if (queue.length === 0) {
        stop();
        return { code: 200, job: null };
      }
      return { code: 200, job: queue.shift() };
    }
    if (call.route === HEARTBEATS_ROUTE) {
      return { code: 200, leaseExpiresAt: 1, signals: [] };
    }
    if (call.route.endsWith('/transitions')) {
      const action = actionOf(call.body);
      if (action === 'start' && scenario.failStartOnce && startFailures === 0) {
        startFailures += 1;
        throw new Unreachable('factory server did not answer');
      }
      if (action === 'start') {
        return { code: 200, action, status: 'running' };
      }
      if (action === 'complete') {
        return { code: 200, action, completed: true, nextJob: null };
      }
      if (action === 'line_unavailable') {
        return {
          code: 200,
          action,
          markedLineUnavailable: true,
          nextJob: null,
        };
      }
      if (action === 'worktree_missing') {
        return { code: 200, action, resetToScratch: true, nextJob: resetJob };
      }
    }
    throw new Error(`unexpected call ${call.method} ${call.route}`);
  };
};

const runScenario = async (scenario: Scenario) => {
  const controller = new AbortController();
  const state = memoryCellState(
    scenario.session === undefined ? null : scenario.session,
  );
  const fake = createFakePorts({
    reply: serverReplies(scenario, () => controller.abort()),
  });
  const runs: RunSpec[] = [];
  let handler: ((request: unknown) => Promise<unknown>) | undefined;
  const ports: Ports = {
    ...fake.ports,
    fs: memoryFs(scenario.files ?? baseFiles()),
    git: NOOP_GIT,
    pr: { publish: async () => undefined },
    cellState: state.port,
    clock: testClock,
    runners: {
      names: () => INSTALLED_RUNNERS,
      isInstalled: async (name) => !(scenario.uninstalled ?? []).includes(name),
      commandLine: (name, promptFile) => ({
        command: 'fake-runner',
        args: [name, promptFile],
      }),
    },
    operator: {
      open: async (_jobId, next) => {
        handler = next;
        return { url: OPERATOR_URL };
      },
      close: async () => {
        handler = undefined;
      },
    },
    runner: {
      start: async (spec: RunSpec): Promise<RunHandle> => {
        runs.push(spec);
        void handler?.({
          verb: 'done',
          token: spec.env.FACTORY_CYCLE_TOKEN,
        });
        return { id: `run-${runs.length}` };
      },
      abort: async () => undefined,
      wait: () => new Promise<RunOutcome>(() => undefined),
    },
  };
  await startCell(ports, {
    repoRoot: REPO,
    cellName: 'Dev Box',
    joinToken: scenario.joinToken ?? JOIN_TOKEN,
    signal: controller.signal,
  });
  return { calls: fake.calls, runs, stateWrites: state.writes };
};

const startStubServer = (): Promise<StubServer> =>
  new Promise((resolve) => {
    const hits: StubServer['hits'] = [];
    const server = createServer((request: IncomingMessage, response) => {
      hits.push({ method: request.method });
      request.resume();
      response.statusCode = 200;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ code: 200 }));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/`, hits, server });
    });
  });

const runCli = (
  args: readonly string[],
  env: Record<string, string>,
  cwd: string,
): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { env, cwd });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), COMMAND_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });

const fixture: { stub?: StubServer; cwd: string } = {
  cwd: mkdtempSync(join(tmpdir(), 'factory-cell-cli-')),
};

beforeAll(async () => {
  fixture.stub = await startStubServer();
});

afterAll(() => {
  fixture.stub?.server.close();
});

describe('cell lifecycle', () => {
  it('enrolls once, runs one job and completes it', async () => {
    // Arrange
    const scenario: Scenario = { claims: [job(), null] };

    // Act
    const { calls, runs, stateWrites } = await runScenario(scenario);

    // Assert
    const enrolls = calls.filter((call) => call.route === ENROLL_ROUTE);
    expect(enrolls).toHaveLength(1);
    expect(enrolls[0]?.token).toBe(JOIN_TOKEN);
    expect(bodyOf(enrolls[0] as ServerCall).name).toBe('dev-box');
    expect(stateWrites).toEqual([
      { cellId: CELL_ID, sessionToken: SESSION_TOKEN },
    ]);
    expect(JSON.stringify(stateWrites)).not.toContain(JOIN_TOKEN);
    expect(
      bodyOf(calls.find((call) => call.route === HELLO_ROUTE) as ServerCall),
    ).toMatchObject({ projectId: PROJECT, runners: INSTALLED_RUNNERS });
    expect(actionsOf(calls)).toEqual(['start', 'complete']);
    expect(bodyOf(transitionCalls(calls)[1] as ServerCall).commandId).toBe(
      commandIdOf({
        cellId: CELL_ID,
        orderId: 'software-factory:cli-08',
        epoch: 7,
        command: 'complete',
      }),
    );
    expect(bodyOf(transitionCalls(calls)[1] as ServerCall).commitSha).toBe(
      'abc123',
    );
    expect(calls.map((call) => call.route).join(' ')).not.toContain('drain');
    const claimWaits = calls
      .filter((call) => call.route === CLAIMS_ROUTE)
      .map((call) => bodyOf(call).waitMs);
    expect(claimWaits).toEqual([CLAIM_WAIT_MS, CLAIM_WAIT_MS, CLAIM_WAIT_MS]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.env.FACTORY_OPERATOR_URL).toBe(OPERATOR_URL);
    expect(runs[0]?.env.FACTORY_CYCLE_TOKEN).toMatch(/^[0-9a-f]{32}$/);
    expect(runs[0]).toMatchObject({
      command: 'fake-runner',
      args: [RUNNER, '.cell/plan/prompt.md'],
      logPath: join(REPO, '.worktrees', 'cli-08', '.cell', 'plan', 'step.log'),
    });
  });

  it('sends line_unavailable and never starts when the station runner is not installed', async () => {
    // Arrange
    const scenario: Scenario = { claims: [job(), null], uninstalled: [RUNNER] };

    // Act
    const { calls, runs } = await runScenario(scenario);

    // Assert
    expect(actionsOf(calls)).toEqual(['line_unavailable']);
    expect(bodyOf(transitionCalls(calls)[0] as ServerCall).detail).toBe(
      'runner not installed: claude',
    );
    expect(runs).toHaveLength(0);
  });

  it('reuses the stored session without enrolling again', async () => {
    // Arrange
    const session = { cellId: CELL_ID, sessionToken: SESSION_TOKEN };
    const scenario: Scenario = { claims: [null], session, joinToken: '' };

    // Act
    const { calls, stateWrites } = await runScenario(scenario);

    // Assert
    expect(calls.some((call) => call.route === ENROLL_ROUTE)).toBe(false);
    expect(stateWrites).toEqual([]);
    expect(calls.find((call) => call.route === HELLO_ROUTE)?.token).toBe(
      SESSION_TOKEN,
    );
  });

  it('refuses to enroll without a join token', async () => {
    // Arrange
    const scenario: Scenario = { claims: [], session: null, joinToken: '' };

    // Act
    const attempt = runScenario(scenario);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(Refused);
  });

  it('sends line_unavailable and never starts when the line is missing', async () => {
    // Arrange
    const missingLine = job({ payload: { lineName: 'missing' } });
    const scenario: Scenario = { claims: [missingLine, null] };

    // Act
    const { calls, runs } = await runScenario(scenario);

    // Assert
    expect(actionsOf(calls)).toEqual(['line_unavailable']);
    expect(bodyOf(transitionCalls(calls)[0] as ServerCall).lineName).toBe(
      'missing',
    );
    expect(runs).toHaveLength(0);
  });

  it('sends worktree_missing and then runs step zero fresh', async () => {
    // Arrange
    const resumed = job({
      stepId: 'build',
      expectedPriorSteps: [
        {
          stepId: 'plan',
          stationId: 'plan',
          stepIndex: 0,
          requiredFiles: ['plan.md'],
        },
      ],
    });
    const scenario: Scenario = {
      claims: [resumed, null],
      resetJob: job({ epoch: 8, expectedPriorSteps: [] }),
    };

    // Act
    const { calls, runs } = await runScenario(scenario);

    // Assert
    expect(actionsOf(calls)).toEqual(['worktree_missing', 'start', 'complete']);
    expect(bodyOf(transitionCalls(calls)[0] as ServerCall).missingStepId).toBe(
      'plan',
    );
    expect(bodyOf(transitionCalls(calls)[1] as ServerCall).epoch).toBe(8);
    expect(runs).toHaveLength(1);
  });

  it('sends the same commandId when a start is retried', async () => {
    // Arrange
    const scenario: Scenario = { claims: [job(), null], failStartOnce: true };

    // Act
    const { calls } = await runScenario(scenario);

    // Assert
    const starts = transitionCalls(calls).filter(
      (call) => actionOf(call.body) === 'start',
    );
    expect(starts).toHaveLength(2);
    expect(bodyOf(starts[1] as ServerCall).commandId).toBe(
      bodyOf(starts[0] as ServerCall).commandId,
    );
  });

  it('lists cells with their active job', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({
        code: 200,
        cells: [
          {
            cellId: CELL_ID,
            projectId: PROJECT,
            name: 'dev-box',
            status: 'busy',
            allowedLines: ['feature'],
            runners: ['fake'],
            activeJobId: 'job-1',
            lastHeartbeatAt: 0,
            leaseExpiresAt: null,
          },
        ],
      }),
    });

    // Act
    const result = await runProcedure(listCells, {}, fake);

    // Assert
    expect(fake.calls[0]?.route).toBe(CELLS_ROUTE);
    expect(result.rows).toEqual([
      {
        cellId: CELL_ID,
        projectId: PROJECT,
        status: 'busy',
        activeJobId: 'job-1',
        lastHeartbeatAt: 0,
      },
    ]);
  });
});

describe('cell revoke command', () => {
  it('refuses revoke without --yes and sends nothing', async () => {
    // Arrange
    const stub = fixture.stub as StubServer;
    const before = stub.hits.length;
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: fixture.cwd,
      FACTORY_URL: stub.url,
      FACTORY_TOKEN: 'supervisor-stub-value',
    };

    // Act
    const result = await runCli(
      ['cell', 'revoke', '--id', CELL_ID],
      env,
      fixture.cwd,
    );

    // Assert
    expect(result.code).toBe(EXIT_REVOKE_REFUSED);
    expect(stub.hits.length).toBe(before);
    expect(result.stderr).toContain('--yes');
  });

  it('revokes the cell with --yes', async () => {
    // Arrange
    const stub = fixture.stub as StubServer;
    const before = stub.hits.length;
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: fixture.cwd,
      FACTORY_URL: stub.url,
      FACTORY_TOKEN: 'supervisor-stub-value',
    };

    // Act
    const result = await runCli(
      ['cell', 'revoke', '--id', CELL_ID, '--yes'],
      env,
      fixture.cwd,
    );

    // Assert
    expect(result.code).toBe(EXIT.ok);
    expect(stub.hits.slice(before).map((hit) => hit.method)).toEqual([
      'DELETE',
    ]);
    expect(result.stdout).toContain(`revoked ${CELL_ID}`);
  });
});
