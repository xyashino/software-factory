import { describe, expect, it } from 'vitest';
import {
  createHerdrPane,
  findJsonString,
  type HerdrExec,
  type HerdrOutcome,
} from '../../runners/herdr-pane';

/** Answers by the first two arguments of a call (`workspace list`), or else by the first (`tab`). */
const recording = (answers: Record<string, HerdrOutcome>) => {
  const calls: string[][] = [];
  const exec: HerdrExec = async (args) => {
    calls.push([...args]);
    const key = `${args[0] ?? ''} ${args[1] ?? ''}`;
    return (
      answers[key] ??
      answers[args[0] ?? ''] ?? { code: 0, stdout: '', stderr: '' }
    );
  };
  return { calls, exec };
};

const launch = {
  command: ['claude', '--print', 'hi'],
  cwd: '/work',
  env: { FACTORY_OPERATOR_URL: 'http://127.0.0.1:4321' },
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
  'workspace list': {
    code: 0,
    stdout: '{"result":{"workspaces":[]}}',
    stderr: '',
  },
};

const listingOf = (label: string, workspaceId: string): HerdrOutcome => ({
  code: 0,
  stdout: JSON.stringify({
    result: { workspaces: [{ label, workspace_id: workspaceId }] },
  }),
  stderr: '',
});

describe('herdr pane driver', () => {
  it('returns the tab it opened, and closes that tab once a later Cell adopts the pane', async () => {
    const { calls, exec } = recording(answers);
    const opened = await createHerdrPane({ exec }).open({
      name: 'build_1',
      task: 'todo-a',
      ...launch,
    });
    expect(opened).toEqual({ tabId: 't1' });

    const later = createHerdrPane({ exec });
    later.adopt('build_1', opened, 'todo-a');
    await later.close('build_1');

    expect(calls.at(-1)).toEqual(['tab', 'close', 't1']);
  });

  it('creates a workspace for the task, then opens the Operator tab in it', async () => {
    const { calls, exec } = recording(answers);
    const pane = createHerdrPane({ exec });

    await pane.open({ name: 'build_1', task: 'todo-a', ...launch });

    expect(calls[1]).toEqual([
      'workspace',
      'create',
      '--cwd',
      '/work',
      '--label',
      'todo-a',
      '--no-focus',
    ]);
    expect(calls[2]).toEqual(
      expect.arrayContaining([
        'tab',
        'create',
        '--workspace',
        'w1',
        '--cwd',
        '/work',
      ]),
    );
    expect(calls[2]).toContain('FACTORY_OPERATOR_URL=http://127.0.0.1:4321');
    expect(calls[3]).toEqual([
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

    const workspaceCreates = calls.filter(
      (c) => c[0] === 'workspace' && c[1] === 'create',
    );
    expect(workspaceCreates).toHaveLength(2);
    const tabCreates = calls.filter((c) => c[0] === 'tab' && c[1] === 'create');
    expect(tabCreates.map((c) => c[c.indexOf('--workspace') + 1])).toEqual([
      'w1',
      'w1',
      'w1',
    ]);
  });

  it('reuses the workspace Herdr lists for a task after a restart, creating none', async () => {
    const { calls, exec } = recording({
      ...answers,
      'workspace list': listingOf('todo-a', 'w9'),
    });
    const pane = createHerdrPane({ exec });

    await pane.open({ name: 'build_1', task: 'todo-a', ...launch });

    expect(calls.some((c) => c[0] === 'workspace' && c[1] === 'create')).toBe(
      false,
    );
    expect(calls.find((c) => c[0] === 'tab' && c[1] === 'create')).toContain(
      'w9',
    );
  });

  it('closes the listed workspace of a task after a restart', async () => {
    const { calls, exec } = recording({
      ...answers,
      'workspace list': listingOf('todo-a', 'w9'),
    });

    await createHerdrPane({ exec }).closeTask('todo-a');

    expect(calls.at(-1)).toEqual(['workspace', 'close', 'w9']);
  });

  it('closes the earlier operator tab of the same task before it opens a new one', async () => {
    const { calls, exec } = recording(answers);
    const pane = createHerdrPane({ exec });

    await pane.open({ name: 'build_1', task: 'todo-a', ...launch });
    await pane.open({ name: 'audit_1', task: 'todo-a', ...launch });

    const closeAt = calls.findIndex((c) => c[0] === 'tab' && c[1] === 'close');
    const secondTabAt = calls.reduce(
      (last, c, i) => (c[0] === 'tab' && c[1] === 'create' ? i : last),
      -1,
    );
    expect(closeAt).toBeGreaterThan(-1);
    expect(closeAt).toBeLessThan(secondTabAt);
    expect(calls[closeAt]).toEqual(['tab', 'close', 't1']);
  });

  it('keeps the operator tab open when the mechanic of the same task opens its own', async () => {
    const { calls, exec } = recording(answers);
    const pane = createHerdrPane({ exec });

    await pane.open({ name: 'build_1', task: 'todo-a', ...launch });
    await pane.open({ name: 'mechanic_abc123_1', task: 'todo-a', ...launch });

    expect(calls.some((c) => c[0] === 'tab' && c[1] === 'close')).toBe(false);
  });

  it('keeps the operator tab of another task open', async () => {
    const { calls, exec } = recording(answers);
    const pane = createHerdrPane({ exec });

    await pane.open({ name: 'build_1', task: 'todo-a', ...launch });
    await pane.open({ name: 'build_1', task: 'todo-b', ...launch });

    expect(calls.some((c) => c[0] === 'tab' && c[1] === 'close')).toBe(false);
  });

  it('closes the operator tab of the same task that a restarted Cell adopted', async () => {
    const { calls, exec } = recording(answers);
    const restarted = createHerdrPane({ exec });
    restarted.adopt('build_1', { tabId: 't1' }, 'todo-a');

    await restarted.open({ name: 'audit_1', task: 'todo-a', ...launch });

    expect(calls).toContainEqual(['tab', 'close', 't1']);
  });

  it('keeps the adopted operator tab of another task open', async () => {
    const { calls, exec } = recording(answers);
    const restarted = createHerdrPane({ exec });
    restarted.adopt('build_1', { tabId: 't1' }, 'todo-b');

    await restarted.open({ name: 'audit_1', task: 'todo-a', ...launch });

    expect(calls.some((c) => c[0] === 'tab' && c[1] === 'close')).toBe(false);
  });

  it('closes the mechanic tab of the same task that a restarted Cell adopted', async () => {
    const { calls, exec } = recording(answers);
    const restarted = createHerdrPane({ exec });
    restarted.adopt('mechanic_abc123_1', { tabId: 't1' }, 'todo-a');

    await restarted.open({
      name: 'mechanic_abc123_2',
      task: 'todo-a',
      ...launch,
    });

    expect(calls).toContainEqual(['tab', 'close', 't1']);
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
