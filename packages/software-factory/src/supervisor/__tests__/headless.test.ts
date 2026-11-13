import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BunProcessAdapter } from '../../adapters/system/process.adapter';
import { resolveCaller } from '../../cli/caller';
import { boardRows, renderBoard } from '../../cli/board';
import { runVerdict } from '../../cli/commands/verdict';
import type { AgentDef, Definitions } from '../../definitions/types';
import { reduce } from '../../engine/reduce';
import { worktreeDir } from '../../paths';
import { runSupervisor } from '../run';
import { launchHeadless, STDERR_LOG, STDOUT_LOG } from '../headless';
import { reconcile } from '../reconcile';
import { ScriptedHerdr, wireAgents } from './agents';
import {
  definitions as shipped,
  harness,
  scratchRoot,
  todoText,
  type Harness,
} from './fixtures';
import { plainPaint } from '../../paint';

const USAGE_JSON = JSON.stringify({
  result: 'ok',
  usage: { input_tokens: 120, output_tokens: 30 },
  total_cost_usd: 0.25,
});

/** The shipped `feature` workflow with its doctor run headless and read-only. */
const withHeadlessDoctor = (
  permission: AgentDef['permission'],
): Definitions => {
  const feature = shipped.workflows.get('feature');
  const doctor = feature?.agents.doctor;
  if (feature === undefined || doctor === undefined) {
    throw new Error('feature.yml must define a doctor');
  }
  const workflows = new Map(shipped.workflows);
  workflows.set('feature', {
    ...feature,
    agents: {
      ...feature.agents,
      doctor: {
        ...doctor,
        runner: 'claude',
        model: 'haiku',
        headless: true,
        permission,
      },
    },
  });
  return { ...shipped, workflows };
};

const pause = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe('headless agent step', () => {
  it('runs without a Herdr pane and records the verdict the agent reports', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.ports.definitions = withHeadlessDoctor('read');
    const herdr = new ScriptedHerdr();
    h.ports.herdr = herdr;
    wireAgents(h, herdr);
    h.process.script = async (input) => {
      const caller = resolveCaller(input.env, h.store, h.ports.definitions);
      runVerdict(caller, 'pass');
      return { exitCode: 0, stdout: USAGE_JSON };
    };

    const controller = new AbortController();
    const loop = runSupervisor(h.ports, {
      signal: controller.signal,
      log: () => undefined,
      sleep: pause,
    });
    for (let i = 0; i < 300; i++) {
      await pause();
      if (h.store.tasks()[0]?.status === 'delivered') break;
    }
    controller.abort();
    await loop;

    expect(h.store.tasks()[0]?.status).toBe('delivered');
    const spawn = h.process.spawned[0];
    expect(spawn?.command[0]).toBe('claude');
    expect(spawn?.command).toEqual(
      expect.arrayContaining([
        '--disallowedTools',
        'Write,Edit,MultiEdit,NotebookEdit',
      ]),
    );
    expect(spawn?.cwd).toBe(worktreeDir(root, 'hello'));
    expect(spawn?.timeoutMs).toBe(20 * 60_000);
    // Only the pane steps opened tabs; the audit never touched Herdr.
    const tabs = herdr.calls
      .filter((call) => call.method === 'createTab')
      .map((call) => JSON.stringify(call.args));
    expect(tabs.some((tab) => tab.includes('audit'))).toBe(false);
    expect(
      herdr.calls.filter((call) => call.method === 'closeTab'),
    ).not.toContainEqual({ method: 'closeTab', args: [''] });

    const state = reduce(
      h.ports.definitions.workflows.get('feature')!,
      h.store.events('hello'),
    );
    const audit = state.attempts.find((attempt) => attempt.stepId === 'audit');
    expect(audit).toMatchObject({
      status: 'passed',
      outcome: 'verdict_pass',
      usage: {
        model: 'haiku',
        inputTokens: 120,
        outputTokens: 30,
        costUsd: 0.25,
      },
    });
  });

  it('shows token and cost totals on the board', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.ports.definitions = withHeadlessDoctor('read');
    const herdr = new ScriptedHerdr();
    h.ports.herdr = herdr;
    wireAgents(h, herdr);
    h.process.script = async (input) => {
      runVerdict(
        resolveCaller(input.env, h.store, h.ports.definitions),
        'pass',
      );
      return { exitCode: 0, stdout: USAGE_JSON };
    };
    const controller = new AbortController();
    const loop = runSupervisor(h.ports, {
      signal: controller.signal,
      log: () => undefined,
      sleep: pause,
    });
    for (let i = 0; i < 300; i++) {
      await pause();
      if (h.store.tasks()[0]?.status === 'delivered') break;
    }
    controller.abort();
    await loop;

    const rows = boardRows(h.store, h.ports.definitions, h.clock.now());
    expect(rows[0]?.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      costUsd: 0.25,
    });
    const text = renderBoard(rows, plainPaint);
    expect(text).toContain('120/30');
    expect(text).toContain('$0.2500');
  });

  it('fails the attempt as crashed when the run ends without a verdict', async () => {
    const h = seeded();
    h.process.script = async () => ({ exitCode: 3, stdout: USAGE_JSON });
    startHeadlessAudit(h, 'write');
    await settled(h);

    expect(failureOf(h)?.reason).toBe('crashed');
    expect(failureOf(h)?.detail).toContain('code 3');
    expect(usageOf(h)).toMatchObject({ inputTokens: 120 });
  });

  it('fails the attempt as timed out when the supervisor timeout killed it', async () => {
    const h = seeded();
    h.process.script = async () => ({ exitCode: null, timedOut: true });
    startHeadlessAudit(h, 'write');
    await settled(h);

    expect(failureOf(h)).toMatchObject({ reason: 'timed_out' });
    expect(usageOf(h)).toBeUndefined();
  });

  it('leaves the attempt alone when the verdict already arrived', async () => {
    const h = seeded();
    h.process.script = async (input) => {
      runVerdict(
        resolveCaller(input.env, h.store, h.ports.definitions),
        'pass',
      );
      return { exitCode: 0, stdout: USAGE_JSON };
    };
    startHeadlessAudit(h, 'read');
    await settled(h);

    expect(failureOf(h)).toBeUndefined();
    expect(usageOf(h)).toMatchObject({ outputTokens: 30 });
  });

  it('fails a headless attempt of a restarted supervisor and stops its process', async () => {
    const h = seeded();
    h.process.script = () => new Promise(() => undefined);
    startHeadlessAudit(h, 'read');
    h.store.setTaskStatus('hello', 'running');

    await reconcile(h.ports);

    expect(failureOf(h)).toMatchObject({ reason: 'crashed' });
    expect(h.process.killed).toHaveLength(1);
  });
});

describe('read-only enforcement by the runner', () => {
  /** A stand-in `claude` that, like the real one, cannot write when file tools are denied. */
  const installFakeClaude = (): string => {
    const bin = mkdtempSync(join(tmpdir(), 'sf-fakebin-'));
    const script = [
      '#!/usr/bin/env bash',
      'mode=write; prev=""',
      'for arg in "$@"; do',
      '  if [ "$prev" = "--disallowedTools" ] && [ "$arg" = "Write,Edit,MultiEdit,NotebookEdit" ]; then mode=read; fi',
      '  prev="$arg"',
      'done',
      'if [ "$mode" = read ]; then',
      '  echo "refused: read-only" >&2',
      'else',
      '  echo written > written.txt',
      'fi',
      `echo '${USAGE_JSON}'`,
    ].join('\n');
    const path = join(bin, 'claude');
    writeFileSync(path, script, { mode: 0o755 });
    return bin;
  };

  const runWith = async (
    permission: AgentDef['permission'],
  ): Promise<{
    h: Harness;
    worktree: string;
    evidence: string;
  }> => {
    const bin = installFakeClaude();
    const h = seeded();
    h.ports.process = new BunProcessAdapter();
    h.ports.pathEnv = `${bin}:${Bun.env.PATH ?? ''}`;
    const worktree = worktreeDir(h.root, 'hello');
    mkdirSync(worktree, { recursive: true });
    const evidence = startHeadlessAudit(h, permission);
    for (let i = 0; i < 400 && failureOf(h) === undefined; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { h, worktree, evidence };
  };

  it('refuses writes when the agent is read-only', async () => {
    const { worktree, evidence, h } = await runWith('read');

    expect(existsSync(join(worktree, 'written.txt'))).toBe(false);
    expect(readFileSync(join(evidence, STDERR_LOG), 'utf8')).toContain(
      'refused: read-only',
    );
    expect(readFileSync(join(evidence, STDOUT_LOG), 'utf8')).toContain(
      'total_cost_usd',
    );
    expect(usageOf(h)).toMatchObject({ inputTokens: 120, costUsd: 0.25 });
    expect(failureOf(h)).toMatchObject({ reason: 'crashed' });
  });

  it('lets a write agent change files through the same path', async () => {
    const { worktree } = await runWith('write');

    expect(readFileSync(join(worktree, 'written.txt'), 'utf8')).toBe(
      'written\n',
    );
  });
});

/** A task whose build is passed and whose audit is next, ready for a headless attempt. */
const seeded = (): Harness => {
  const root = scratchRoot({ 'hello.md': todoText('todo') });
  const h = harness(root);
  h.ports.definitions = withHeadlessDoctor('read');
  h.store.createTask({
    taskId: 'hello',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  h.store.append('hello', {
    type: 'task_created',
    workflow: 'feature',
    todoPath: 'todos/hello.md',
    branch: 'factory/hello',
  });
  h.store.append('hello', { type: 'setup_finished', ok: true, log: '' });
  return h;
};

/** Records the audit attempt as the supervisor would, then launches its headless run. */
const startHeadlessAudit = (
  h: Harness,
  permission: AgentDef['permission'],
): string => {
  const workflow = h.ports.definitions.workflows.get('feature');
  const doctor = workflow?.agents.doctor;
  if (doctor === undefined) throw new Error('no doctor');
  const evidenceDir = join(h.root, '.evidences', 'hello', 'att-audit');
  mkdirSync(evidenceDir, { recursive: true });
  h.store.append('hello', {
    type: 'attempt_started',
    attemptId: 'att-audit',
    stepId: 'audit',
    n: 1,
    snapshotRef: 'snap',
    artifacts: { feedback: join(evidenceDir, 'feedback.md') },
  });
  const { pid } = launchHeadless(h.ports, {
    taskId: 'hello',
    attemptId: 'att-audit',
    agent: { ...doctor, headless: true, permission },
    worktree: worktreeDir(h.root, 'hello'),
    promptPath: join(evidenceDir, 'prompt.md'),
    evidenceDir,
  });
  h.store.append('hello', {
    type: 'agent_ready',
    attemptId: 'att-audit',
    pane: `headless:${pid}`,
    tab: '',
  });
  return evidenceDir;
};

const settled = async (h: Harness): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    await pause();
    if (h.store.runningAttempt('hello', 'att-audit') === undefined) return;
  }
};

const failureOf = (h: Harness) => {
  return h.store
    .events('hello')
    .flatMap((stored) =>
      stored.event.type === 'attempt_failed' ? [stored.event] : [],
    )[0];
};

const usageOf = (h: Harness) => {
  return h.store
    .events('hello')
    .flatMap((stored) =>
      stored.event.type === 'usage_recorded' ? [stored.event] : [],
    )[0];
};
