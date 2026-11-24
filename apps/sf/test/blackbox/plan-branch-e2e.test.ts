import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitAdapter } from '../../src/adapters/git/git';
import { createProcessAdapter } from '../../src/adapters/process/spawn';
import type { Ports } from '../../src/application/core/procedure';
import type {
  CellRuntime,
  ClaimedJob,
} from '../../src/application/procedures/cell/cell-runtime';
import { runJob } from '../../src/application/procedures/cell/run-job.procedure';
import { createFakePorts, type HqCall } from '../support/fake-ports';

const EMAIL = 'factory-test@example.invalid';
const PLAN_SLUG = 'standalone-factory';
const PLAN_ID = `proj-1:${PLAN_SLUG}`;
const PLAN_BRANCH = `feat/${PLAN_SLUG}`;
const ROOT_SLUG = 'cli-11';
const ROOT_BRANCH = `factory/${ROOT_SLUG}`;
const TRANSITIONS_SUFFIX = '/transitions';

interface Sandbox {
  root: string;
  remote: string;
  repo: string;
  worktree: string;
}

const PLAN_JOB: ClaimedJob = {
  jobId: 'job-plan',
  kind: 'plan_branch',
  orderId: null,
  planId: PLAN_ID,
  stepId: null,
  workspaceMode: 'fresh',
  epoch: 1,
  leaseExpiresAt: 0,
  repoUrl: 'git@example.test:repo.git',
  baseBranch: 'main',
  baseCommitSha: null,
  headCommitSha: null,
  targetBranch: PLAN_BRANCH,
  expectedPriorSteps: [],
  payload: { planId: PLAN_ID },
};

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const createSandbox = (): Sandbox => {
  const root = mkdtempSync(join(tmpdir(), 'factory-plan-e2e-'));
  const remote = join(root, 'origin.git');
  const repo = join(root, 'repo');
  git(root, ['init', '--bare', '-b', 'main', remote]);
  git(root, ['init', '-b', 'main', repo]);
  git(repo, ['config', 'user.name', 'Factory Test']);
  git(repo, ['config', 'user.email', EMAIL]);
  git(repo, ['remote', 'add', 'origin', remote]);
  writeFileSync(join(repo, 'README.md'), 'seed\n');
  git(repo, ['add', '--', '.']);
  git(repo, ['commit', '-m', 'chore: seed']);
  git(repo, ['push', '-u', 'origin', 'main']);
  return {
    root,
    remote,
    repo,
    worktree: join(repo, '.worktrees', ROOT_SLUG),
  };
};

const transitionReply = (body: unknown): unknown => {
  const action = (body as { action: string }).action;
  if (action === 'complete') {
    return { code: 200, action, completed: true, nextJob: null };
  }
  if (action === 'fail') {
    return { code: 200, action, failed: true, nextJob: null };
  }
  return { code: 200, action: 'start', status: 'running' };
};

const sandboxPorts = (): { ports: Ports; calls: HqCall[] } => {
  const fake = createFakePorts({
    reply: (call) =>
      call.route.endsWith(TRANSITIONS_SUFFIX)
        ? transitionReply(call.body)
        : { code: 200 },
  });
  const processPort = createProcessAdapter();
  return {
    calls: fake.calls,
    ports: {
      ...fake.ports,
      process: processPort,
      git: createGitAdapter(processPort),
      fs: {
        ...fake.ports.fs,
        appendText: async (path, text) => appendFileSync(path, text),
      },
    },
  };
};

const completionOf = (
  calls: HqCall[],
): { action: string; commitSha?: string }[] =>
  calls
    .filter((call) => call.route.endsWith(TRANSITIONS_SUFFIX))
    .map((call) => call.body as { action: string; commitSha?: string });

describe('plan branch e2e', () => {
  let sandbox: Sandbox;
  let ports: Ports;
  let calls: HqCall[];
  let runtime: CellRuntime;

  beforeEach(() => {
    sandbox = createSandbox();
    ({ ports, calls } = sandboxPorts());
    runtime = {
      ports,
      session: { cellId: 'cell-1', sessionToken: 'session-token' },
      projectId: 'proj-1',
      allowedLines: [],
      runners: [],
      repoRoot: sandbox.repo,
      logPath: join(sandbox.root, 'cell.log'),
      signal: new AbortController().signal,
    };
  });

  afterEach(() => {
    rmSync(sandbox.root, { recursive: true, force: true });
  });

  it('activates the plan by pushing its branch to origin and completes with that commit', async () => {
    // Arrange
    const mainSha = git(sandbox.repo, ['rev-parse', 'main']);

    // Act
    await runJob(runtime, PLAN_JOB);

    // Assert
    expect(
      git(sandbox.repo, ['ls-remote', sandbox.remote, PLAN_BRANCH]),
    ).toContain(mainSha);
    expect(completionOf(calls).at(-1)).toMatchObject({
      action: 'complete',
      commitSha: mainSha,
    });
  });

  it('starts the root work order worktree from the plan branch that exists only on origin', async () => {
    // Arrange
    const mainSha = git(sandbox.repo, ['rev-parse', 'main']);
    await runJob(runtime, PLAN_JOB);
    expect(git(sandbox.repo, ['branch', '--list', PLAN_BRANCH])).toBe('');

    // Act
    await ports.git.worktreeAdd(
      sandbox.repo,
      sandbox.worktree,
      ROOT_BRANCH,
      PLAN_BRANCH,
    );

    // Assert
    expect(git(sandbox.worktree, ['rev-parse', 'HEAD'])).toBe(mainSha);
    expect(git(sandbox.worktree, ['branch', '--show-current'])).toBe(
      ROOT_BRANCH,
    );
  });
});
