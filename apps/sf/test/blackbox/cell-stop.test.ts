import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Refused } from '../../src/application/core/errors';
import type { Ports } from '../../src/application/core/procedure';
import type { ClaimedJob } from '../../src/application/procedures/cell/cell-runtime';
import { stopCell } from '../../src/application/procedures/cell/stop.procedure';
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
import { HEARTBEAT_INTERVAL_MS } from '../../src/config';
import { commandIdOf } from '../../src/domain/cell/command-id';
import { EXIT } from '../../src/domain/exit-codes';
import { freePort, runFactoryCommand } from '../support/factory-daemon';
import {
  createFakePorts,
  PROJECTS_REPLY,
  PROJECTS_ROUTE,
  runProcedure,
  type ServerCall,
} from '../support/fake-ports';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;

const REPO = '/repo';
const PROJECT = 'software-factory';
const CELL_ID = 'software-factory-dev-box';
const SESSION_TOKEN = 'sf_cell_stub_session';
const CLAIMS_ROUTE = '/api/v1/cells/claims';
const HEARTBEATS_ROUTE = '/api/v1/cells/heartbeats';
const LEAVE_ROUTE = '/api/v1/cells/leave';
const HELLO_ROUTE = '/api/v1/cells/hello';
const DRAIN_ROUTE = `/api/v1/cells/${CELL_ID}/drain`;
const FEATURE_LINE = [
  'name: feature',
  'stations:',
  '  - id: plan',
  '    kind: operator',
  '    runner: claude',
  '',
].join('\n');

interface Scenario {
  claims: { job: ClaimedJob | null; signals?: string[] }[];
  beatSignals?: string[];
  finishOnBeat?: boolean;
  nextJob?: ClaimedJob;
  staleLeave?: boolean;
  signalOnStart?: boolean;
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const job = (overrides: Partial<ClaimedJob> = {}): ClaimedJob => ({
  jobId: 'job-1',
  kind: 'operator',
  orderId: 'software-factory:cli-11',
  planId: null,
  stepId: 'plan',
  workspaceMode: 'fresh',
  epoch: 7,
  leaseExpiresAt: 1,
  repoUrl: 'git@example.test:software-factory.git',
  baseBranch: 'main',
  baseCommitSha: null,
  targetBranch: 'factory/cli-11',
  expectedPriorSteps: [],
  payload: { lineName: 'feature' },
  ...overrides,
});

const bodyOf = (call: ServerCall): Record<string, unknown> =>
  typeof call.body === 'object' && call.body !== null
    ? (call.body as Record<string, unknown>)
    : {};

const routesOf = (calls: ServerCall[]): string[] =>
  calls.map((call) => `${call.method} ${call.route}`);

const actionOf = (call: ServerCall): unknown => bodyOf(call).action;

const leaveCallsOf = (calls: ServerCall[]): ServerCall[] =>
  calls.filter((call) => call.route === LEAVE_ROUTE);

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

const files = (): Record<string, string> => ({
  [join(REPO, '.factory', 'config.json')]: JSON.stringify({ project: PROJECT }),
  [join(REPO, '.factory', 'lines', 'feature.yml')]: FEATURE_LINE,
});

const memoryCellState = (session: CellSession): CellStatePort => {
  let stored: CellSession | null = session;
  return {
    read: async () => stored,
    write: async (next) => {
      stored = next;
    },
  };
};

const runScenario = async (scenario: Scenario) => {
  const controller = new AbortController();
  const runs: RunSpec[] = [];
  const aborts: RunHandle[] = [];
  let operatorHandler: ((request: unknown) => Promise<unknown>) | undefined;
  let heartbeatSleeps = 0;
  let claimIndex = 0;
  const fake = createFakePorts({
    reply: (call) => {
      if (call.route === PROJECTS_ROUTE) {
        return PROJECTS_REPLY;
      }
      if (call.route === HELLO_ROUTE) {
        return { code: 200, cellId: CELL_ID };
      }
      if (call.route === CLAIMS_ROUTE) {
        const next = scenario.claims[claimIndex] ?? { job: null };
        claimIndex += 1;
        const signals = next.signals ?? [];
        if (
          next.job === null &&
          signals.length === 0 &&
          claimIndex >= scenario.claims.length
        ) {
          controller.abort();
        }
        return { code: 200, job: next.job, signals };
      }
      if (call.route === HEARTBEATS_ROUTE) {
        if (scenario.finishOnBeat) {
          void operatorHandler?.({
            verb: 'done',
            token: runs[0]?.env.FACTORY_CYCLE_TOKEN,
          });
        }
        return {
          code: 200,
          leaseExpiresAt: 1,
          signals: scenario.beatSignals ?? [],
        };
      }
      if (call.route === LEAVE_ROUTE) {
        if (scenario.staleLeave) {
          throw new Refused('409: stale', {
            code: 409,
            type: 'stale-lease-epoch',
            message: 'stale',
          });
        }
        return { code: 200, status: 'left' };
      }
      if (call.route.endsWith('/transitions')) {
        const action = actionOf(call);
        if (action === 'complete') {
          return {
            code: 200,
            action,
            completed: true,
            nextJob: scenario.nextJob ?? null,
          };
        }
        return { code: 200, action, status: 'running' };
      }
      throw new Error(`unexpected call ${call.method} ${call.route}`);
    },
  });
  const ports: Ports = {
    ...fake.ports,
    fs: memoryFs(files()),
    git: NOOP_GIT,
    pr: { publish: async () => undefined },
    cellState: memoryCellState({
      cellId: CELL_ID,
      sessionToken: SESSION_TOKEN,
    }),
    clock: {
      now: () => 0,
      sleep: (ms: number) => {
        if (ms !== HEARTBEAT_INTERVAL_MS) return Promise.resolve();
        heartbeatSleeps += 1;
        return heartbeatSleeps > 1
          ? new Promise<void>(() => undefined)
          : Promise.resolve();
      },
    } satisfies ClockPort,
    runners: {
      names: () => ['claude'],
      isInstalled: async () => true,
      commandLine: (name, promptFile) => ({
        command: 'fake-runner',
        args: [name, promptFile],
      }),
    },
    operator: {
      open: async (_jobId, next) => {
        operatorHandler = next;
        return { url: 'http://127.0.0.1:9/' };
      },
      close: async () => {
        operatorHandler = undefined;
      },
    },
    runner: {
      prepare: async () => undefined,
      start: async (spec: RunSpec): Promise<RunHandle> => {
        runs.push(spec);
        if (scenario.signalOnStart) controller.abort();
        return { id: `run-${runs.length}` };
      },
      abort: async (handle) => {
        aborts.push(handle);
        return true;
      },
      wait: () => new Promise<RunOutcome>(() => undefined),
    },
  };
  const outcome = await startCell(ports, {
    repoRoot: REPO,
    cellName: 'dev-box',
    joinToken: undefined,
    signal: controller.signal,
  });
  return { calls: fake.calls, runs, aborts, outcome };
};

const stubServer = (): Promise<{
  url: string;
  calls: string[];
  server: Server;
}> =>
  new Promise((resolve) => {
    const calls: string[] = [];
    const server = createServer((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(fixture.drainReply));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/`, calls, server });
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

const fixture: {
  stub?: { url: string; calls: string[]; server: Server };
  daemonPort?: number;
  cwd: string;
  drainReply: {
    code: number;
    status: string;
    force: boolean;
    offline: boolean;
  };
} = {
  cwd: mkdtempSync(join(tmpdir(), 'factory-cell-stop-')),
  drainReply: { code: 200, status: 'draining', force: false, offline: false },
};

const stopEnv = (): Record<string, string> => {
  const stub = fixture.stub as NonNullable<typeof fixture.stub>;
  return {
    PATH: process.env.PATH ?? '',
    HOME: fixture.cwd,
    FACTORY_URL: stub.url,
    FACTORY_TOKEN: 'supervisor-stub-value',
    SF_FACTORY_PORT: String(fixture.daemonPort),
  };
};

beforeAll(async () => {
  fixture.stub = await stubServer();
  fixture.daemonPort = await freePort();
  expect(await runFactoryCommand(stopEnv(), 'start')).toBe(EXIT.ok);
});

afterAll(async () => {
  await runFactoryCommand(stopEnv(), 'stop');
  fixture.stub?.server.close();
});

describe('cell stop request', () => {
  it('sends one drain request and no other request', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({
        code: 200,
        status: 'draining',
        force: false,
        offline: false,
      }),
    });

    // Act
    await runProcedure(stopCell, { id: CELL_ID, force: false }, fake);

    // Assert
    expect(routesOf(fake.calls)).toEqual([`POST ${DRAIN_ROUTE}`]);
    expect(bodyOf(fake.calls[0] as ServerCall)).toEqual({ force: false });
  });

  it('asks for a forced drain when force is set', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({
        code: 200,
        status: 'draining',
        force: true,
        offline: false,
      }),
    });

    // Act
    const result = await runProcedure(
      stopCell,
      { id: CELL_ID, force: true },
      fake,
    );

    // Assert
    expect(bodyOf(fake.calls[0] as ServerCall)).toEqual({ force: true });
    expect(result).toEqual({
      cellId: CELL_ID,
      status: 'draining',
      force: true,
      offline: false,
    });
  });
});

describe('cell drain on the Cell side', () => {
  it('leaves at once without a job and exits cleanly', async () => {
    // Arrange
    const scenario: Scenario = {
      claims: [{ job: null, signals: ['drain'] }],
    };

    // Act
    const { calls, runs, outcome } = await runScenario(scenario);

    // Assert
    expect(runs).toHaveLength(0);
    expect(outcome).toBe('stopped');
    const leaves = leaveCallsOf(calls);
    expect(leaves).toHaveLength(1);
    expect(bodyOf(leaves[0] as ServerCall)).toEqual({
      commandId: commandIdOf({
        cellId: CELL_ID,
        orderId: 'cell',
        epoch: 0,
        command: 'leave',
      }),
      epoch: 0,
    });
    expect(routesOf(calls).at(-1)).toBe(`POST ${LEAVE_ROUTE}`);
  });

  it('lets the station finish, then leaves after its transition', async () => {
    // Arrange
    const scenario: Scenario = {
      claims: [{ job: job() }],
      beatSignals: ['drain'],
      finishOnBeat: true,
    };

    // Act
    const { calls, aborts, outcome } = await runScenario(scenario);

    // Assert
    const transitions = calls.filter((call) =>
      call.route.endsWith('/transitions'),
    );
    expect(transitions.map(actionOf)).toEqual(['start', 'complete']);
    expect(aborts).toHaveLength(0);
    expect(routesOf(calls).slice(-2)).toEqual([
      'POST /api/v1/jobs/job-1/transitions',
      `POST ${LEAVE_ROUTE}`,
    ]);
    expect(bodyOf(leaveCallsOf(calls)[0] as ServerCall)).not.toHaveProperty(
      'jobId',
    );
    expect(outcome).toBe('stopped');
  });

  it('hands the next job over on leave instead of running it', async () => {
    // Arrange
    const next = job({ jobId: 'job-2', epoch: 8, stepId: 'build' });
    const scenario: Scenario = {
      claims: [{ job: job() }],
      beatSignals: ['drain'],
      finishOnBeat: true,
      nextJob: next,
    };

    // Act
    const { calls, runs } = await runScenario(scenario);

    // Assert
    expect(runs).toHaveLength(1);
    expect(bodyOf(leaveCallsOf(calls)[0] as ServerCall)).toMatchObject({
      jobId: 'job-2',
      epoch: 8,
    });
  });

  it('aborts the runner and hands its job over with the current epoch when forced', async () => {
    // Arrange
    const scenario: Scenario = {
      claims: [{ job: job() }],
      beatSignals: ['drain', 'force'],
    };

    // Act
    const { calls, aborts, outcome } = await runScenario(scenario);

    // Assert
    expect(aborts).toHaveLength(1);
    expect(calls.some((call) => call.route.endsWith('/transitions'))).toBe(
      true,
    );
    expect(calls.filter((call) => actionOf(call) === 'complete')).toHaveLength(
      0,
    );
    expect(bodyOf(leaveCallsOf(calls)[0] as ServerCall)).toEqual({
      commandId: commandIdOf({
        cellId: CELL_ID,
        orderId: 'software-factory:cli-11',
        epoch: 7,
        command: 'leave',
      }),
      epoch: 7,
      jobId: 'job-1',
    });
    expect(outcome).toBe('stopped');
  });

  it('aborts the runner, hands the job back and resolves when signalled mid-job', async () => {
    // Arrange
    const scenario: Scenario = {
      claims: [{ job: job() }],
      signalOnStart: true,
    };

    // Act
    const { calls, aborts, outcome } = await runScenario(scenario);

    // Assert
    expect(aborts).toHaveLength(1);
    expect(calls.filter((call) => actionOf(call) === 'complete')).toHaveLength(
      0,
    );
    expect(bodyOf(leaveCallsOf(calls)[0] as ServerCall)).toMatchObject({
      epoch: 7,
      jobId: 'job-1',
    });
    expect(outcome).toBe('stopped');
  });

  it('exits as superseded when the server already moved its job', async () => {
    // Arrange
    const scenario: Scenario = {
      claims: [{ job: null, signals: ['drain'] }],
      staleLeave: true,
    };

    // Act
    const { outcome } = await runScenario(scenario);

    // Assert
    expect(outcome).toBe('superseded');
  });
});

describe('cell stop command', () => {
  it('prints the graceful drain line with one drain request', async () => {
    // Arrange
    const stub = fixture.stub as NonNullable<typeof fixture.stub>;
    const before = stub.calls.length;
    fixture.drainReply = {
      code: 200,
      status: 'draining',
      force: false,
      offline: false,
    };

    // Act
    const result = await runCli(
      ['cell', 'stop', '--id', CELL_ID],
      stopEnv(),
      fixture.cwd,
    );

    // Assert
    expect(result.stderr).toBe('');
    expect(result.code).toBe(EXIT.ok);
    expect(stub.calls.slice(before)).toEqual([
      `POST /api/v1/cells/${CELL_ID}/drain`,
    ]);
    expect(result.stdout).toBe(
      `cell ${CELL_ID} draining: leaves after the current station; use --force to abort it now\n`,
    );
  });

  it('prints the forced drain line when the drain is forced', async () => {
    // Arrange
    fixture.drainReply = {
      code: 200,
      status: 'draining',
      force: true,
      offline: false,
    };

    // Act
    const result = await runCli(
      ['cell', 'stop', '--id', CELL_ID, '--force'],
      stopEnv(),
      fixture.cwd,
    );

    // Assert
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toBe(
      `cell ${CELL_ID} draining (force): current station is aborted at the next heartbeat\n`,
    );
  });

  it('warns that an offline Cell will not receive the drain', async () => {
    // Arrange
    fixture.drainReply = {
      code: 200,
      status: 'draining',
      force: false,
      offline: true,
    };

    // Act
    const result = await runCli(
      ['cell', 'stop', '--id', CELL_ID],
      stopEnv(),
      fixture.cwd,
    );

    // Assert
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain(`cell ${CELL_ID} draining`);
    expect(result.stderr).toBe(
      'Cell is offline, no heartbeat will deliver this; check the process or `sf cell revoke`\n',
    );
  });
});
