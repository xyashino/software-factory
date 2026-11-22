import { describe, expect, it, vi } from 'vitest';
import type { Ports } from '../../../src/application/core/procedure';
import type {
  CellRuntime,
  ClaimedJob,
} from '../../../src/application/procedures/cell/cell-runtime';
import { runJob } from '../../../src/application/procedures/cell/run-job.procedure';
import type {
  RunHandle,
  RunOutcome,
} from '../../../src/application/ports/runner.port';
import { drainStateOf } from '../../../src/cell/drain-signal';
import {
  HEARTBEAT_INTERVAL_MS,
  LINES_DIR,
  OPERATORS_DIR,
  WORKTREES_DIR,
} from '../../../src/config';
import { joinPath } from '../../../src/domain/common/path';
import { slugOf } from '../../../src/domain/git/branch-names';
import { createFakePorts } from '../../support/fake-ports';

type Handler = (request: unknown) => Promise<unknown>;

interface Sleeper {
  ms: number;
  wake: () => void;
}

interface Control {
  handler?: Handler;
  exit?: (outcome: RunOutcome) => void;
  env?: Record<string, string>;
  refuseAbort: boolean;
  beat: { signals: string[]; down: boolean };
}

interface Harness {
  runtime: CellRuntime;
  lines: () => string[];
  routes: () => string[];
  control: Control;
  sleepers: Sleeper[];
  advance: (ms: number) => void;
}

const REPO = '/repo';
const GATE_MS = 15_000;
const BUILD_TIMEOUT_MS = 60_000;
const LINE_PATH = joinPath(REPO, LINES_DIR, 'feature.yml');
const PROFILE_PATH = joinPath(REPO, OPERATORS_DIR, 'builder.md');
const WORKTREE = joinPath(REPO, WORKTREES_DIR, slugOf('order-1'));
const HEARTBEATS_ROUTE = '/api/v1/cells/heartbeats';
const LEAVE_ROUTE = '/api/v1/cells/leave';
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

const LINE_YAML = `name: feature
operators:
  builder:
    profile: builder
    runner: claude
    model: sonnet
    headless: false
stations:
  - id: build
    kind: operator
    operator: builder
    timeout: 1m
  - id: quality-gate
    kind: inspection
    exec: ["pnpm ci:verify", "pnpm lint"]
    onFail:
      max: 3
`;

const PROFILE = `---
id: builder
label: Builder
rules: []
skills: []
---

Build task {{taskId}}.
`;

const PANE: RunHandle = {
  id: 'run-1',
  pane: { workspaceId: 'w6E', tabId: 'w6F', paneId: 'w6F:p1' },
};

const jobOf = (patch: Partial<ClaimedJob>): ClaimedJob => ({
  jobId: 'job-1',
  kind: 'step',
  orderId: 'order-1',
  planId: null,
  stepId: null,
  workspaceMode: 'fresh',
  epoch: 1,
  leaseExpiresAt: 0,
  repoUrl: 'git@example.test:repo.git',
  baseBranch: 'main',
  baseCommitSha: null,
  targetBranch: 'factory/order-1',
  expectedPriorSteps: [],
  payload: { lineName: 'feature' },
  ...patch,
});

const harness = (options: {
  interactive: boolean;
  alivePids?: number[];
  psStart?: string;
  runnerPid?: number;
}): Harness => {
  const files = new Map<string, string>([
    [LINE_PATH, LINE_YAML],
    [PROFILE_PATH, PROFILE],
  ]);
  const log: string[] = [];
  const sleepers: Sleeper[] = [];
  const control: Control = {
    refuseAbort: false,
    beat: { signals: [], down: false },
  };
  const clock = { at: 0 };
  const advance = (ms: number): void => {
    clock.at += ms;
    const due = sleepers.filter((sleeper) => sleeper.ms === ms);
    for (const sleeper of due) {
      sleepers.splice(sleepers.indexOf(sleeper), 1);
    }
    for (const sleeper of due) {
      sleeper.wake();
    }
  };
  const fake = createFakePorts({
    alivePids: options.alivePids,
    reply: (call) => {
      if (call.route === HEARTBEATS_ROUTE) {
        if (control.beat.down) throw new Error('server down');
        return {
          code: 200,
          leaseExpiresAt: null,
          signals: control.beat.signals,
        };
      }
      if (call.route === LEAVE_ROUTE) {
        return { code: 200, status: 'left' };
      }
      const action = (call.body as { action?: string } | undefined)?.action;
      if (action === 'start') {
        return { code: 200, action, status: 'running' };
      }
      if (action === 'complete') {
        return { code: 200, action, completed: true, nextJob: null };
      }
      return { code: 200, action, blocked: true };
    },
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
    git: {
      ...fake.ports.git,
      worktreeAdd: async () => undefined,
      excludeLocally: async () => undefined,
      status: async () => '',
      headSha: async () => 'sha',
    },
    process: {
      ...fake.ports.process,
      run: async (command) => {
        if (command === 'ps') {
          return {
            exitCode: 0,
            stdout: `${options.psStart ?? ''}\n`,
            stderr: '',
          };
        }
        clock.at += GATE_MS;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    },
    runner: {
      prepare: async () => undefined,
      start: async (spec) => {
        control.env = spec.env;
        return options.runnerPid === undefined
          ? PANE
          : { ...PANE, pid: options.runnerPid };
      },
      abort: async () => !control.refuseAbort,
      wait: (): Promise<RunOutcome> =>
        new Promise((done) => {
          control.exit = done;
        }),
      interactiveAvailable: async () => options.interactive,
    },
    runners: {
      names: () => ['claude'],
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
      now: () => clock.at,
      sleep: (ms) =>
        new Promise<void>((wake) => {
          sleepers.push({ ms, wake });
        }),
    },
  };
  return {
    runtime: {
      ports,
      session: { cellId: 'cell-1', sessionToken: 'session-token' },
      projectId: 'proj-1',
      repoRoot: REPO,
      logPath: '/repo/cell.log',
      signal: new AbortController().signal,
      drain: drainStateOf(),
    },
    lines: () =>
      log.map((text) => text.replace(ANSI, '').trim().replace(/\s+/g, ' ')),
    routes: () => fake.calls.map((call) => call.route),
    control,
    sleepers,
    advance,
  };
};

const paneLogged = async (h: Harness): Promise<void> => {
  await vi.waitFor(() =>
    expect(h.lines().some((line) => line.includes(' pane '))).toBe(true),
  );
  await vi.waitFor(() => expect(h.control.exit).toBeDefined());
};

const fireAfter = async (h: Harness, ms: number): Promise<void> => {
  await vi.waitFor(() =>
    expect(h.sleepers.some((sleeper) => sleeper.ms === ms)).toBe(true),
  );
  h.advance(ms);
};

describe('cell log detail', () => {
  it('names the runner, model and herdr ids of an operator step', async () => {
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    h.control.exit?.({ exitCode: 0 });
    await job;

    const lines = h.lines();
    expect(lines).toContainEqual(
      expect.stringMatching(
        /build start runner=claude model=sonnet headless=false$/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(/build pane ws=w6E tab=w6F pane=w6F:p1$/),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(/build fail exit=0 duration=0s runner exited/),
    );
  });

  it('logs the claim and the new worktree before the agent starts', async () => {
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);
    h.control.exit?.({ exitCode: 0 });
    await job;

    const lines = h.lines();
    expect(lines[0]).toMatch(/build claim job=job-1 kind=step epoch=1$/);
    expect(lines).toContainEqual(
      expect.stringMatching(
        new RegExp(`build worktree create path=${WORKTREE} base=main$`),
      ),
    );
  });

  it('numbers each inspection command with its attempt, exit code and duration', async () => {
    const h = harness({ interactive: false });
    const prior = {
      stepId: 's1',
      stationId: 'build',
      stepIndex: 0,
      requiredFiles: [],
    };
    for (const path of [
      joinPath(WORKTREE, '.cell', 'worktree.json'),
      joinPath(WORKTREE, '.cell', 'build', 'state.json'),
    ]) {
      await h.runtime.ports.fs.writeText(path, '');
    }

    await runJob(h.runtime, jobOf({ epoch: 2, expectedPriorSteps: [prior] }));

    const gate = h.lines().filter((line) => line.includes(' quality-gate '));
    expect(
      gate.map((line) => line.replace(/^\S+ \S+ quality-gate /, '')),
    ).toEqual([
      'claim job=job-1 kind=step epoch=2',
      'start (2/3) command="pnpm ci:verify"',
      'complete (2/3) exit=0 duration=15s',
      'start (2/3) command="pnpm lint"',
      'complete (2/3) exit=0 duration=15s',
    ]);
  });

  it('lists the missing files when the worktree is gone', async () => {
    const h = harness({ interactive: false });
    const prior = {
      stepId: 's1',
      stationId: 'build',
      stepIndex: 0,
      requiredFiles: [],
    };

    await runJob(h.runtime, jobOf({ expectedPriorSteps: [prior] }));

    expect(h.lines()).toContainEqual(
      expect.stringMatching(
        /worktree_missing missing \.cell\/worktree\.json, \.cell\/build\/state\.json$/,
      ),
    );
  });
});

describe('cell run outcome log', () => {
  it('logs the exit code when the runner exits before a verdict', async () => {
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    h.control.exit?.({ exitCode: 3 });
    await job;

    expect(h.lines()).toContainEqual(
      expect.stringMatching(/build end kind=exited exit=3 duration=0s$/),
    );
  });

  it('logs the verb that ended the run and closes the pane', async () => {
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    await h.control.handler?.({
      verb: 'done',
      token: h.control.env?.FACTORY_CYCLE_TOKEN,
    });
    await job;

    const lines = h.lines();
    expect(lines).toContainEqual(
      expect.stringMatching(
        /build end kind=operator exit=pending duration=0s$/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(/build abort reason=operator confirmed=yes$/),
    );
  });

  it('logs the timeout end and the abort of the runner', async () => {
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    await fireAfter(h, BUILD_TIMEOUT_MS);
    await job;

    const lines = h.lines();
    expect(lines).toContainEqual(
      expect.stringMatching(
        /build end kind=timeout exit=pending duration=60s$/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(/build abort reason=timeout confirmed=yes$/),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /build fail exit=pending duration=60s station timed out after 1m$/,
      ),
    );
  });

  it('marks an abort the runner refused as not confirmed', async () => {
    const h = harness({ interactive: true });
    h.control.refuseAbort = true;
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    await fireAfter(h, BUILD_TIMEOUT_MS);
    await job;

    expect(h.lines()).toContainEqual(
      expect.stringMatching(/build abort reason=timeout confirmed=no$/),
    );
  });

  it('stops the cell from claiming while a stopped runner is still alive', async () => {
    const h = harness({ interactive: true });
    h.control.refuseAbort = true;
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    await fireAfter(h, BUILD_TIMEOUT_MS);
    await job;

    expect(h.lines()).toContainEqual(
      expect.stringMatching(
        /build fail .*runner still alive after abort, Cell left without claiming$/,
      ),
    );
    expect(h.routes()).toContain(LEAVE_ROUTE);
  });

  it('logs the drain-force end and the abort of the runner', async () => {
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    h.control.beat.signals = ['force'];
    await fireAfter(h, HEARTBEAT_INTERVAL_MS);
    await job;

    const lines = h.lines();
    expect(lines).toContainEqual(
      expect.stringMatching(
        /build end kind=drain-force exit=pending duration=10s$/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(/build abort reason=drain-force confirmed=yes$/),
    );
  });

  it('logs the heartbeat failure count that aborted the run', async () => {
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    h.control.beat.down = true;
    for (let beat = 0; beat < 4; beat += 1) {
      await fireAfter(h, HEARTBEAT_INTERVAL_MS);
    }
    await job;

    const lines = h.lines();
    expect(lines).toContainEqual(
      expect.stringMatching(
        /build end kind=aborted exit=pending duration=40s$/,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /build abort reason=heartbeat failures=4 confirmed=yes$/,
      ),
    );
  });

  it('keeps tokens out of every log line', async () => {
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);
    const cycleToken = h.control.env?.FACTORY_CYCLE_TOKEN ?? '';

    await h.control.handler?.({ verb: 'done', token: cycleToken });
    await job;

    const text = h.lines().join('\n');
    expect(cycleToken).not.toBe('');
    expect(text).not.toContain(cycleToken);
    expect(text).not.toContain('session-token');
  });
});

const RUNNER_PATH = joinPath(WORKTREE, '.cell', 'build', 'runner.json');
const STARTED_AT = 'Sat Nov 21 15:29:22 2026';

const heldLockJson = (pid: number, pidStartedAt: string): string =>
  JSON.stringify({
    interactive: true,
    reason: '',
    runId: 'run-9',
    pid,
    pidStartedAt,
    pane: 'w5J:p2',
    startedAt: 1,
  });

describe('step runner lock', () => {
  it('refuses a second start while the lock names a live runner', async () => {
    // Arrange
    const h = harness({
      interactive: true,
      alivePids: [4242],
      psStart: STARTED_AT,
    });
    await h.runtime.ports.fs.writeText(
      RUNNER_PATH,
      heldLockJson(4242, STARTED_AT),
    );

    // Act
    await runJob(h.runtime, jobOf({}));

    // Assert
    expect(h.lines()).toContainEqual(
      expect.stringMatching(
        /build fail .*runner still holds this step: runner=run-9 pid=4242 pane=w5J:p2$/,
      ),
    );
    expect(h.control.env?.FACTORY_CYCLE_TOKEN).toBeUndefined();
  });

  it('takes over a lock whose runner pid is gone and logs it', async () => {
    // Arrange
    const h = harness({ interactive: true });
    await h.runtime.ports.fs.writeText(
      RUNNER_PATH,
      heldLockJson(4242, STARTED_AT),
    );

    // Act
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);
    h.control.exit?.({ exitCode: 0 });
    await job;

    // Assert
    expect(h.lines()).toContainEqual(
      expect.stringMatching(/build lock takeover stale runner=run-9 pid=4242$/),
    );
    expect(h.control.env?.FACTORY_CYCLE_TOKEN).toBeDefined();
  });

  it('takes over a lock whose pid now belongs to another process', async () => {
    // Arrange
    const h = harness({
      interactive: true,
      alivePids: [4242],
      psStart: 'Sun Nov 22 09:00:00 2026',
    });
    await h.runtime.ports.fs.writeText(
      RUNNER_PATH,
      heldLockJson(4242, STARTED_AT),
    );

    // Act
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);
    h.control.exit?.({ exitCode: 0 });
    await job;

    // Assert
    expect(h.lines()).toContainEqual(
      expect.stringMatching(/build lock takeover stale runner=run-9 pid=4242$/),
    );
  });

  it('records the runner pid and pane while the runner is alive', async () => {
    // Arrange
    const h = harness({
      interactive: true,
      runnerPid: 4242,
      alivePids: [4242],
      psStart: STARTED_AT,
    });

    // Act
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);
    const during = JSON.parse(await h.runtime.ports.fs.readText(RUNNER_PATH));
    h.control.exit?.({ exitCode: 0 });
    await job;

    // Assert
    expect(during).toMatchObject({
      runId: 'run-1',
      pid: 4242,
      pidStartedAt: STARTED_AT,
      pane: 'w6F:p1',
    });
  });

  it('releases the step lock after a normal exit', async () => {
    // Arrange
    const h = harness({ interactive: true });

    // Act
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);
    h.control.exit?.({ exitCode: 0 });
    await job;

    // Assert
    expect(await h.runtime.ports.fs.readText(RUNNER_PATH)).not.toContain(
      'runId',
    );
  });

  it('releases the step lock after a failed exit', async () => {
    // Arrange
    const h = harness({ interactive: true });

    // Act
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);
    h.control.exit?.({ exitCode: 1 });
    await job;

    // Assert
    expect(await h.runtime.ports.fs.readText(RUNNER_PATH)).not.toContain(
      'runId',
    );
  });

  it('releases the step lock after the runner is stopped by its own verb', async () => {
    // Arrange
    const h = harness({ interactive: true });
    const job = runJob(h.runtime, jobOf({}));
    await paneLogged(h);

    // Act
    await h.control.handler?.({
      verb: 'done',
      token: h.control.env?.FACTORY_CYCLE_TOKEN,
    });
    await job;

    // Assert
    expect(await h.runtime.ports.fs.readText(RUNNER_PATH)).not.toContain(
      'runId',
    );
  });
});
