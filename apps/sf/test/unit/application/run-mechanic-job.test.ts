import { describe, expect, it, vi } from 'vitest';
import type { Ports } from '../../../src/application/core/procedure';
import type {
  CellRuntime,
  ClaimedJob,
} from '../../../src/application/procedures/cell/cell-runtime';
import { runJob } from '../../../src/application/procedures/cell/run-job.procedure';
import type {
  AbortOptions,
  RunOutcome,
  RunSpec,
} from '../../../src/application/ports/runner.port';
import { LINES_DIR, OPERATORS_DIR, WORKTREES_DIR } from '../../../src/config';
import { joinPath } from '../../../src/domain/common/path';
import { slugOf } from '../../../src/domain/git/branch-names';
import { createFakePorts, type ServerCall } from '../../support/fake-ports';

type Handler = (request: unknown) => Promise<unknown>;

const REPO = '/repo';
const MECHANIC_TIMEOUT_MS = 20 * 60_000;
const LINE_PATH = joinPath(REPO, LINES_DIR, 'feature.yml');
const PROFILE_PATH = joinPath(REPO, OPERATORS_DIR, 'mechanic.md');
const WORKTREE = joinPath(REPO, WORKTREES_DIR, slugOf('order-1'));

const LINE_YAML = `name: feature
stations:
  - id: build
    kind: operator
    operator: builder
  - id: quality-gate
    kind: inspection
mechanic:
  profile: mechanic
  runner: antigravity
  model: gemini-3.8-flash-medium
  timeout: 20m
  headless: false
  permission: read
`;

const PROFILE = `---
id: mechanic
label: Mechanic
rules: []
skills: [caveman]
---

Triage task {{taskId}}, attempt {{attemptId}}.
`;

const JOB: ClaimedJob = {
  jobId: 'job-1',
  kind: 'mechanic',
  orderId: 'order-1',
  planId: null,
  stepId: null,
  workspaceMode: 'reuse',
  epoch: 1,
  leaseExpiresAt: 0,
  repoUrl: 'git@example.test:repo.git',
  baseBranch: 'main',
  baseCommitSha: null,
  targetBranch: 'factory/order-1',
  expectedPriorSteps: [],
  incidentId: 'inc-1',
  payload: {
    lineName: 'feature',
    incident: { reason: 'step_retries_exhausted', detail: 'gate red' },
  },
};

interface Harness {
  runtime: CellRuntime;
  calls: ServerCall[];
  runs: RunSpec[];
  aborts: (AbortOptions | undefined)[];
  log: string[];
  control: {
    handler?: Handler;
    exit?: (outcome: RunOutcome) => void;
  };
}

const PANE = { workspaceId: 'w1', tabId: 'w1:t1', paneId: 'w1:t1:p1' };
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

const logTextOf = (h: Harness): string =>
  h.log.join('\n').replace(ANSI, '').replace(/\s+/g, ' ');

const transitionReply = (body: unknown) =>
  (body as { action: string }).action === 'fail'
    ? { code: 200, action: 'fail', failed: true, nextJob: JOB }
    : { code: 200, action: 'start', status: 'running' };

const harness = (
  options: { timeoutFires?: boolean; interactive?: boolean } = {},
): Harness => {
  const files = new Map<string, string>([
    [LINE_PATH, LINE_YAML],
    [PROFILE_PATH, PROFILE],
    [WORKTREE, ''],
  ]);
  const runs: RunSpec[] = [];
  const aborts: (AbortOptions | undefined)[] = [];
  const log: string[] = [];
  const control: Harness['control'] = {};
  const fake = createFakePorts({
    reply: (call) =>
      call.route.endsWith('/transitions')
        ? transitionReply(call.body)
        : { code: 200 },
  });
  const ports: Ports = {
    ...fake.ports,
    fs: {
      ...fake.ports.fs,
      readText: async (path) => {
        const text = files.get(path);
        if (text === undefined) throw new Error(`ENOENT ${path}`);
        return text;
      },
      writeText: async (path, text) => {
        files.set(path, text);
      },
      appendText: async (_path, text) => {
        log.push(text);
      },
      exists: async (path) => files.has(path),
    },
    runner: {
      prepare: async () => undefined,
      start: async (spec) => {
        runs.push(spec);
        return options.interactive === true
          ? { id: 'run-1', pane: PANE }
          : { id: 'run-1' };
      },
      abort: async (_handle, abortOptions) => {
        aborts.push(abortOptions);
        return true;
      },
      wait: (): Promise<RunOutcome> =>
        new Promise((done) => {
          control.exit = done;
        }),
      interactiveAvailable: async () => options.interactive === true,
    },
    runners: {
      names: () => ['antigravity'],
      isInstalled: async () => true,
      commandLine: (name, promptFile) => ({
        command: name,
        args: [promptFile],
      }),
    },
    operator: {
      open: async (_jobId, next) => {
        control.handler = next;
        return { url: 'http://127.0.0.1:0/' };
      },
      close: async () => undefined,
    },
    clock: {
      now: () => 0,
      sleep: (ms) =>
        options.timeoutFires === true && ms === MECHANIC_TIMEOUT_MS
          ? Promise.resolve()
          : new Promise<void>(() => undefined),
    },
  };
  return {
    runtime: {
      ports,
      session: { cellId: 'cell-1', sessionToken: 'session-token' },
      projectId: 'proj-1',
      repoRoot: REPO,
      signal: new AbortController().signal,
    },
    calls: fake.calls,
    runs,
    aborts,
    log,
    control,
  };
};

const startedRun = async (h: Harness): Promise<RunSpec> => {
  await vi.waitFor(() => expect(h.runs).toHaveLength(1));
  const [run] = h.runs;
  if (run === undefined) throw new Error('no run started');
  return run;
};

const operatorOf = async (h: Harness): Promise<Handler> => {
  await vi.waitFor(() => expect(h.control.handler).toBeDefined());
  const handler = h.control.handler;
  if (handler === undefined) throw new Error('no operator endpoint');
  return handler;
};

const exitRunWith = async (h: Harness, outcome: RunOutcome): Promise<void> => {
  await vi.waitFor(() => expect(h.control.exit).toBeDefined());
  h.control.exit?.(outcome);
};

const tokenOf = (run: RunSpec): string => run.env['FACTORY_CYCLE_TOKEN'] ?? '';

const transitionsOf = (h: Harness): { action: string; detail?: string }[] =>
  h.calls
    .filter((call) => call.route.endsWith('/transitions'))
    .map((call) => call.body as { action: string; detail?: string });

describe('mechanic job', () => {
  it('serves the incident and its step states to factory-operator read', async () => {
    const h = harness();
    const job = runJob(h.runtime, JOB);
    const run = await startedRun(h);
    const handler = await operatorOf(h);

    const reply = await handler({ verb: 'read', token: tokenOf(run) });

    expect(reply).toMatchObject({
      code: 200,
      incident: { reason: 'step_retries_exhausted', detail: 'gate red' },
      steps: [
        { stationId: 'build', kind: 'operator' },
        { stationId: 'quality-gate', kind: 'inspection' },
      ],
    });
    await exitRunWith(h, { exitCode: 0 });
    await job;
  });

  it('resolves its incident at the station that factory-operator incident names', async () => {
    const h = harness();
    const job = runJob(h.runtime, JOB);
    const run = await startedRun(h);
    const handler = await operatorOf(h);

    const reply = await handler({
      verb: 'incident',
      action: 'retry_step',
      step: 'build',
      diagnosis: 'gate flaked',
      outcome: 'no edits',
      report: 'Retry the build.',
      token: tokenOf(run),
    });

    expect(reply).toEqual({ code: 200 });
    expect(await job).toBeNull();
    expect(h.calls).toContainEqual(
      expect.objectContaining({
        route: '/api/v1/incidents/inc-1/resolve',
        body: { action: 'retry_step', stepIndex: 0, epoch: 1 },
      }),
    );
  });

  it('refuses an incident that retries a step the line does not declare', async () => {
    const h = harness();
    const job = runJob(h.runtime, JOB);
    const run = await startedRun(h);
    const handler = await operatorOf(h);

    const reply = await handler({
      verb: 'incident',
      action: 'retry_step',
      step: 'no-such-station',
      diagnosis: 'x',
      outcome: 'x',
      report: 'x',
      token: tokenOf(run),
    });

    expect(reply).toMatchObject({ code: 400 });
    await exitRunWith(h, { exitCode: 0 });
    await job;
    expect(h.calls.some((call) => call.route.includes('/resolve'))).toBe(false);
  });

  it('refuses a verdict, which only station jobs may send', async () => {
    const h = harness();
    const job = runJob(h.runtime, JOB);
    const run = await startedRun(h);
    const handler = await operatorOf(h);

    const reply = await handler({
      verb: 'verdict',
      outcome: 'pass',
      token: tokenOf(run),
    });

    expect(reply).toMatchObject({ code: 400 });
    await exitRunWith(h, { exitCode: 0 });
    await job;
  });

  it('fails the mechanic job when its runner exits before an incident', async () => {
    const h = harness();
    const job = runJob(h.runtime, JOB);
    await startedRun(h);

    await exitRunWith(h, { exitCode: 1 });
    await job;

    expect(transitionsOf(h)).toContainEqual(
      expect.objectContaining({
        action: 'fail',
        detail: 'mechanic exited with code 1 before an incident resolution',
      }),
    );
  });

  it('fails the mechanic job when it outlives its timeout', async () => {
    const h = harness({ timeoutFires: true });

    await runJob(h.runtime, JOB);

    expect(transitionsOf(h)).toContainEqual(
      expect.objectContaining({
        action: 'fail',
        detail: 'mechanic timed out after 20m',
      }),
    );
  });
});

describe('mechanic pane', () => {
  it('logs the pane ids of the tab it opens when herdr is up', async () => {
    // Arrange
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, JOB);
    const run = await startedRun(h);
    const handler = await operatorOf(h);

    // Act
    await handler({
      verb: 'incident',
      action: 'retry_step',
      step: 'build',
      diagnosis: 'gate flaked',
      outcome: 'no edits',
      report: 'Retry the build.',
      token: tokenOf(run),
    });
    await job;

    // Assert
    expect(logTextOf(h)).toMatch(
      /mechanic start runner=antigravity model=gemini-3.8-flash-medium headless=false/,
    );
    expect(logTextOf(h)).toMatch(/mechanic pane ws=w1 tab=w1:t1 pane=w1:t1:p1/);
  });

  it('keeps its pane open after it resolves its incident', async () => {
    // Arrange
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, JOB);
    const run = await startedRun(h);
    const handler = await operatorOf(h);

    // Act
    await handler({
      verb: 'incident',
      action: 'retry_step',
      step: 'build',
      diagnosis: 'gate flaked',
      outcome: 'no edits',
      report: 'Retry the build.',
      token: tokenOf(run),
    });
    await job;

    // Assert
    expect(h.aborts).toEqual([{ keepPane: true }]);
  });

  it('closes its pane when it times out', async () => {
    // Arrange
    const h = harness({ interactive: true, timeoutFires: true });

    // Act
    await runJob(h.runtime, JOB);

    // Assert
    expect(h.aborts).toEqual([{ keepPane: false }]);
  });

  it('logs why it runs headless when herdr is down', async () => {
    // Arrange
    const h = harness({ interactive: false });
    const job = runJob(h.runtime, JOB);
    await startedRun(h);
    await exitRunWith(h, { exitCode: 1 });

    // Act
    await job;

    // Assert
    expect(logTextOf(h)).toMatch(
      /mechanic headless fallback=herdr server unavailable/,
    );
  });
});
