import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reduce } from '../../engine/reduce';
import { FakeSystem } from '../../testing/fake-system';
import type { CommandResult } from '../../ports/system.port';
import { runSupervisor, tick } from '../run';
import {
  definitions,
  harness,
  scratchRoot,
  todoText,
  type Harness,
} from './fixtures';
import { ScriptedHerdr, wireAgents } from './agents';

/** A system whose `pnpm test` fails on the first call only. */
class FlakyTestSystem extends FakeSystem {
  private testRuns = 0;
  override async run(input: {
    command: string;
    cwd: string;
    timeoutMs: number;
    logPath: string;
  }): Promise<CommandResult> {
    if (input.command === 'pnpm test') {
      this.testRuns += 1;
      const fail = this.testRuns === 1;
      mkdirSync(dirname(input.logPath), { recursive: true });
      writeFileSync(
        input.logPath,
        fail ? '\u001b[31mexpected 2 got 3\u001b[0m\n' : 'all green\n',
      );
      return { exitCode: fail ? 1 : 0, timedOut: false, durationMs: 1 };
    }
    return super.run(input);
  }
}

const attemptOrder = (h: Harness, taskId: string): string[] => {
  return h.store
    .events(taskId)
    .flatMap((stored) =>
      stored.event.type === 'attempt_started'
        ? [`${stored.event.stepId}#${stored.event.n}`]
        : [],
    );
};

describe('supervisor end to end (fake ports)', () => {
  it('runs feature.yml from a ready todo through every step to deliver', async () => {
    const root = scratchRoot({
      'hello.md': todoText('todo', 'priority: high\n'),
    });
    const h = harness(root);
    const herdr = new ScriptedHerdr();
    h.ports.herdr = herdr;
    wireAgents(h, herdr);

    const logs: string[] = [];
    const controller = new AbortController();
    const loop = runSupervisor(h.ports, {
      signal: controller.signal,
      log: (line) => logs.push(line),
      sleep: async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    });
    for (let i = 0; i < 300; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (h.store.tasks()[0]?.status === 'delivered') break;
    }
    controller.abort();
    await loop;

    expect(h.store.tasks()[0]?.status).toBe('delivered');
    expect(h.ports.workspaces.get('hello')).toBeUndefined();
    expect(attemptOrder(h, 'hello')).toEqual([
      'plan#1',
      'plan-review#1',
      'build#1',
      'quality-gate#1',
      'audit#1',
    ]);
    expect(h.deliverer.calls).toEqual([{ taskId: 'hello', to: 'new-pr' }]);
    // Cleanup after the PR exists: worktree, snapshot refs and Herdr workspace.
    expect(h.git.calls.map((call) => call.method)).toEqual(
      expect.arrayContaining(['removeWorktree', 'deleteSnapshotRefs']),
    );
    expect(h.git.deletedTasks).toEqual(['hello']);
    expect(herdr.calls.some((call) => call.method === 'closeWorkspace')).toBe(
      true,
    );
    expect(h.git.calls.some((call) => call.method === 'createWorktree')).toBe(
      true,
    );
    expect(logs).toContain('picked todos/hello.md as task hello');
    const transcript = logs.filter((line) => line.startsWith('[feature]'));
    expect(transcript).toContain('[feature] ✓ setup');
    expect(transcript.some((line) => line.includes('▶ build — Worker ('))).toBe(
      true,
    );
    expect(
      transcript.some((line) => /▶ quality-gate: .+ \(1\/\d+\)/.test(line)),
    ).toBe(true);
    expect(
      transcript.some((line) => line.includes('✓ delivered — https://')),
    ).toBe(true);
    expect(transcript.at(-1)).toBe('[feature] next: sf status · sf log hello');
    const starts = transcript.filter((line) => line.includes('▶ build'));
    expect(new Set(starts).size).toBe(starts.length);
    expect(herdr.calls.some((call) => call.method === 'createWorkspace')).toBe(
      true,
    );
    const tabEnv = herdr.calls.find(
      (call) =>
        call.method === 'createTab' &&
        (call.args[0] as { label: string }).label !== 'cli',
    )?.args[0] as {
      env: Record<string, string>;
    };
    expect(tabEnv.env.FACTORY_TASK).toBe('hello');
    expect(tabEnv.env.PATH?.startsWith('/')).toBe(true);
    expect(tabEnv.env.PATH?.endsWith(':/usr/bin')).toBe(true);
  });

  it('sends a failing gate back to build with its output, then delivers', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root, new FlakyTestSystem());
    const herdr = new ScriptedHerdr();
    h.ports.herdr = herdr;
    wireAgents(h, herdr);

    for (
      let i = 0;
      i < 300 && h.store.tasks()[0]?.status !== 'delivered';
      i++
    ) {
      await tick(h.ports, () => undefined);
    }

    expect(h.store.tasks()[0]?.status).toBe('delivered');
    expect(attemptOrder(h, 'hello')).toEqual([
      'plan#1',
      'plan-review#1',
      'build#1',
      'quality-gate#1',
      'build#2',
      'quality-gate#2',
      'audit#1',
    ]);
    const feature = definitions.workflows.get('feature');
    if (feature === undefined) throw new Error('feature workflow missing');
    const retry = reduce(feature, h.store.events('hello'));
    expect(
      retry.attempts.find(
        (attempt) => attempt.n === 2 && attempt.stepId === 'build',
      )?.feedbackFrom,
    ).toBeDefined();
    const promptPath = join(root, '.evidences', 'hello');
    const buildTwo = retry.attempts.find(
      (attempt) => attempt.stepId === 'build' && attempt.n === 2,
    );
    expect(buildTwo).toBeDefined();
    const prompt = readFileSync(
      join(promptPath, buildTwo?.attemptId ?? '', 'prompt.md'),
      'utf8',
    );
    expect(prompt).toContain('Quality gate failed: `pnpm test`');
    expect(prompt).toContain('expected 2 got 3');
    expect(prompt).not.toContain('\u001b');
  });

  it('parks at deliver when the deliverer fails, with the task parked', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    const herdr = new ScriptedHerdr();
    h.ports.herdr = herdr;
    wireAgents(h, herdr);
    h.ports.deliverer = {
      deliver: async () => {
        throw new Error('gh pr create failed');
      },
      publishBlocked: async () => {
        throw new Error('gh pr create failed');
      },
    };
    for (let i = 0; i < 300 && h.store.tasks()[0]?.status !== 'parked'; i++) {
      await tick(h.ports, () => undefined);
    }
    expect(h.store.tasks()[0]?.status).toBe('parked');
    expect(h.store.events('hello').at(-2)?.event).toEqual({
      type: 'delivery_failed',
      detail: 'gh pr create failed',
    });
  });
});

describe('supervisor after delivery (fake ports)', () => {
  it('leaves a delivered task alone, whatever happens on its PR', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    const herdr = new ScriptedHerdr();
    h.ports.herdr = herdr;
    wireAgents(h, herdr);
    const statusOf = (taskId: string): string | undefined =>
      h.store.tasks().find((row) => row.id === taskId)?.status;

    for (let i = 0; i < 300 && statusOf('hello') !== 'delivered'; i++) {
      await tick(h.ports, () => undefined);
    }
    expect(statusOf('hello')).toBe('delivered');

    // A reviewer comments on the open PR; the supervisor never starts follow-up work.
    h.clock.advance(60 * 60 * 1000);
    await tick(h.ports, () => undefined);
    expect(h.store.tasks()).toHaveLength(1);
    expect(h.deliverer.calls).toEqual([{ taskId: 'hello', to: 'new-pr' }]);
  });
});
