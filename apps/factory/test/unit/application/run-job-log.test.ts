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
import { LINES_DIR, OPERATORS_DIR, WORKTREES_DIR } from '../../../src/config';
import { joinPath } from '../../../src/domain/common/path';
import { slugOf } from '../../../src/domain/git/branch-names';
import { createFakePorts } from '../../support/fake-ports';

type Handler = (request: unknown) => Promise<unknown>;

const REPO = '/repo';
const GATE_MS = 15_000;
const LINE_PATH = joinPath(REPO, LINES_DIR, 'feature.yml');
const PROFILE_PATH = joinPath(REPO, OPERATORS_DIR, 'builder.md');
const WORKTREE = joinPath(REPO, WORKTREES_DIR, slugOf('order-1'));
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

interface Harness {
  runtime: CellRuntime;
  lines: () => string[];
  control: { handler?: Handler; exit?: (outcome: RunOutcome) => void };
}

const harness = (options: { interactive: boolean }): Harness => {
  const files = new Map<string, string>([
    [LINE_PATH, LINE_YAML],
    [PROFILE_PATH, PROFILE],
  ]);
  const log: string[] = [];
  const control: Harness['control'] = {};
  const clock = { at: 0 };
  const fake = createFakePorts({
    reply: (call) => {
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
      run: async () => {
        clock.at += GATE_MS;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    },
    runner: {
      prepare: async () => undefined,
      start: async () => PANE,
      abort: async () => undefined,
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
      sleep: () => new Promise<void>(() => undefined),
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
    control,
  };
};

const paneLogged = async (h: Harness): Promise<void> => {
  await vi.waitFor(() =>
    expect(h.lines().some((line) => line.includes(' pane '))).toBe(true),
  );
  await vi.waitFor(() => expect(h.control.exit).toBeDefined());
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
