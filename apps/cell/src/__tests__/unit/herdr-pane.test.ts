import { describe, expect, it } from 'vitest';
import {
  createHerdrPane,
  findJsonString,
  type HerdrExec,
  type HerdrOutcome,
} from '../../runners/herdr-pane';

/** Answers by the first argument of a call: `workspace`, `tab` or `agent`. */
const recording = (answers: Record<string, HerdrOutcome>) => {
  const calls: string[][] = [];
  const exec: HerdrExec = async (args) => {
    calls.push([...args]);
    return answers[args[0] ?? ''] ?? { code: 0, stdout: '', stderr: '' };
  };
  return { calls, exec };
};

const launch = {
  command: ['claude', '--print', 'hi'],
  cwd: '/work',
  env: { FACTORY_OPERATOR_SOCKET: '/s.sock' },
  stdoutPath: '/o',
  stderrPath: '/e',
};

const answers = {
  workspace: {
    code: 0,
    stdout: '{"workspace_id":"w1","tab_id":"t0","pane_id":"p0"}',
    stderr: '',
  },
  tab: { code: 0, stdout: '{"tab_id":"t1","pane_id":"p1"}', stderr: '' },
};

describe('herdr pane driver', () => {
  it('creates a workspace for the task, then opens the Operator tab in it', async () => {
    const { calls, exec } = recording(answers);
    const pane = createHerdrPane({ exec });

    await pane.open({ name: 'build_1', task: 'todo-a', ...launch });

    expect(calls[0]).toEqual([
      'workspace',
      'create',
      '--cwd',
      '/work',
      '--label',
      'todo-a',
      '--no-focus',
    ]);
    expect(calls[1]).toEqual(
      expect.arrayContaining(['tab', 'create', '--workspace', 'w1', '--cwd', '/work']),
    );
    expect(calls[1]).toContain('FACTORY_OPERATOR_SOCKET=/s.sock');
    expect(calls[2]).toEqual([
      'agent',
      'start',
      'build_1',
      '--kind',
      'claude',
      '--pane',
      'p1',
      '--timeout',
      '60000',
      '--',
      '--print',
      'hi',
    ]);
  });

  it('reuses the workspace of a task for its later Operators, and makes a new one per task', async () => {
    const { calls, exec } = recording(answers);
    const pane = createHerdrPane({ exec });

    await pane.open({ name: 'build_1', task: 'todo-a', ...launch });
    await pane.open({ name: 'audit_1', task: 'todo-a', ...launch });
    await pane.open({ name: 'build_1', task: 'todo-b', ...launch });

    const workspaceCreates = calls.filter((c) => c[0] === 'workspace');
    expect(workspaceCreates).toHaveLength(2);
    const tabCreates = calls.filter((c) => c[0] === 'tab');
    expect(tabCreates.map((c) => c[c.indexOf('--workspace') + 1])).toEqual([
      'w1',
      'w1',
      'w1',
    ]);
  });

  it('fails the open when Herdr returns no pane', async () => {
    const { exec } = recording({
      workspace: answers.workspace,
      tab: { code: 0, stdout: '{}', stderr: '' },
    });
    const pane = createHerdrPane({ exec });
    await expect(
      pane.open({ name: 'n', task: 'todo-a', ...launch, cwd: '/' }),
    ).rejects.toThrow(/no tab_id or pane_id/);
  });

  it('fails the open when Herdr returns no workspace', async () => {
    const { exec } = recording({
      workspace: { code: 0, stdout: '{}', stderr: '' },
    });
    const pane = createHerdrPane({ exec });
    await expect(
      pane.open({ name: 'n', task: 'todo-a', ...launch }),
    ).rejects.toThrow(/no workspace_id/);
  });

  it('reads a Herdr status word as the operator observation', async () => {
    const working = createHerdrPane({
      exec: async () => ({
        code: 0,
        stdout: '{"agent_status":"working"}',
        stderr: '',
      }),
    });
    expect(await working.read('n')).toEqual({ operator: 'working' });
    const gone = createHerdrPane({
      exec: async () => ({ code: 1, stdout: '', stderr: 'not found' }),
    });
    expect(await gone.read('n')).toEqual({ operator: 'gone' });
  });

  it('reads a string field of a Herdr answer', () => {
    expect(findJsonString('{"pane_id":"abc"}', 'pane_id')).toBe('abc');
    expect(findJsonString('{}', 'pane_id')).toBeUndefined();
  });
});
