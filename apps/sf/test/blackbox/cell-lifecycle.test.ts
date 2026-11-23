import { describe, expect, it } from 'vitest';
import { Refused, Unreachable } from '../../src/application/core/errors';
import type { Ports } from '../../src/application/core/procedure';
import type { ClaimedJob } from '../../src/application/procedures/cell/cell-runtime';
import { startCell } from '../../src/application/procedures/cell/start.procedure';
import type { ClockPort } from '../../src/application/ports/clock.port';
import type {
  RunHandle,
  RunOutcome,
  RunSpec,
} from '../../src/application/ports/runner.port';
import {
  CLAIM_WAIT_MS,
  HEARTBEAT_INTERVAL_MS,
  cellLogPathOf,
} from '../../src/config';
import { commandIdOf } from '../../src/domain/cell/command-id';
import {
  createFakePorts,
  PROJECTS_REPLY,
  PROJECTS_ROUTE,
  type ServerCall,
} from '../support/fake-ports';
import { basename, dirname, join } from 'node:path';

const REPO = '/repo';
const PROJECT = 'software-factory';
const CELL_ID = 'cell-aaaaaaaa';
const LOCAL_BEARER = 'local-bearer-stub';
const CLAIMS_ROUTE = '/api/v1/cells/claims';
const HEARTBEATS_ROUTE = '/api/v1/cells/heartbeats';
const RUNNER = 'claude';
const INSTALLED_RUNNERS = [RUNNER, 'codex'];
const OPERATOR_URL = 'http://127.0.0.1:9/';
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

interface Scenario {
  claims: (ClaimedJob | null)[];
  uninstalled?: string[];
  failStartOnce?: boolean;
  resetJob?: ClaimedJob;
  relayed?: boolean;
  cellId?: string;
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
  remove: async (path) => {
    delete files[path];
  },
  readStdin: async () => '',
});

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
    if (call.route === PROJECTS_ROUTE) return PROJECTS_REPLY;
    if (call.route === CLAIMS_ROUTE) {
      if (queue.length === 0) {
        stop();
        return { code: 200, job: null, signals: [] };
      }
      return { code: 200, job: queue.shift(), signals: [] };
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
  const fake = createFakePorts({
    reply: serverReplies(scenario, () => controller.abort()),
  });
  const files = baseFiles();
  const runs: RunSpec[] = [];
  let handler: ((request: unknown) => Promise<unknown>) | undefined;
  const ports: Ports = {
    ...fake.ports,
    fs: memoryFs(files),
    git: NOOP_GIT,
    pr: { publish: async () => undefined },
    connection: {
      ...fake.ports.connection,
      token: LOCAL_BEARER,
    },
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
      prepare: async () => undefined,
      start: async (spec: RunSpec): Promise<RunHandle> => {
        runs.push(spec);
        void handler?.({
          verb: 'done',
          token: spec.env.FACTORY_CYCLE_TOKEN,
        });
        return { id: `run-${runs.length}` };
      },
      abort: async () => true,
      wait: () => new Promise<RunOutcome>(() => undefined),
    },
  };
  await startCell(ports, {
    repoRoot: REPO,
    cellId: scenario.cellId ?? CELL_ID,
    logPath: join(REPO, cellLogPathOf('dev-box')),
    lines: undefined,
    relayed: scenario.relayed ?? true,
    signal: controller.signal,
  });
  return { calls: fake.calls, runs, files };
};

describe('cell lifecycle', () => {
  it('claims with its project, lines and runners, then runs one job and completes it', async () => {
    // Arrange
    const scenario: Scenario = { claims: [job(), null] };

    // Act
    const { calls, runs, files } = await runScenario(scenario);

    // Assert
    expect(files[join(REPO, cellLogPathOf('dev-box'))]).toContain('complete');
    const claims = calls.filter((call) => call.route === CLAIMS_ROUTE);
    expect(claims[0]).toMatchObject({ token: LOCAL_BEARER });
    expect(bodyOf(claims[0] as ServerCall)).toMatchObject({
      waitMs: CLAIM_WAIT_MS,
      projectId: PROJECT,
      allowedLines: ['feature'],
      runners: INSTALLED_RUNNERS,
    });
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
    expect(runs).toHaveLength(1);
    expect(runs[0]?.env.FACTORY_OPERATOR_URL).toBe(OPERATOR_URL);
    expect(runs[0]?.env.FACTORY_CYCLE_TOKEN).toMatch(/^[0-9a-f]{32}$/);
    expect(runs[0]).toMatchObject({
      command: 'fake-runner',
      args: [RUNNER, '.cell/plan/prompt.md'],
      logPath: join(REPO, '.worktrees', 'cli-08', '.cell', 'plan', 'step.log'),
    });
  });

  it('refuses to start outside the Factory daemon', async () => {
    // Arrange
    const scenario: Scenario = { claims: [], relayed: false };

    // Act
    const attempt = runScenario(scenario);

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(Refused);
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
});
