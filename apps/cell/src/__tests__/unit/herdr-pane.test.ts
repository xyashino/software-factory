import { describe, expect, it } from 'vitest';
import {
  createHerdrPane,
  findJsonString,
  type HerdrExec,
  type HerdrOutcome,
} from '../../runners/herdr-pane';

const recording = (answers: Record<string, HerdrOutcome>) => {
  const calls: string[][] = [];
  const exec: HerdrExec = async (args) => {
    calls.push([...args]);
    return answers[args[0] ?? ''] ?? { code: 0, stdout: '', stderr: '' };
  };
  return { calls, exec };
};

describe('herdr pane driver', () => {
  it('opens a tab, then starts the runner in its pane with the Cycle environment', async () => {
    const { calls, exec } = recording({
      tab: { code: 0, stdout: '{"tab_id":"t1","pane_id":"p1"}', stderr: '' },
    });
    const pane = createHerdrPane({ workspaceId: 'w1', exec });

    await pane.open({
      name: 'build_1',
      command: ['claude', '--print', 'hi'],
      cwd: '/work',
      env: { FACTORY_OPERATOR_SOCKET: '/s.sock' },
      stdoutPath: '/o',
      stderrPath: '/e',
    });

    expect(calls[0]).toEqual(
      expect.arrayContaining([
        'tab',
        'create',
        '--workspace',
        'w1',
        '--cwd',
        '/work',
      ]),
    );
    expect(calls[0]).toContain('FACTORY_OPERATOR_SOCKET=/s.sock');
    expect(calls[1]).toEqual([
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

  it('fails the open when Herdr returns no pane', async () => {
    const { exec } = recording({ tab: { code: 0, stdout: '{}', stderr: '' } });
    const pane = createHerdrPane({ workspaceId: 'w1', exec });
    await expect(
      pane.open({
        name: 'n',
        command: ['x'],
        cwd: '/',
        env: {},
        stdoutPath: '/o',
        stderrPath: '/e',
      }),
    ).rejects.toThrow(/no tab_id or pane_id/);
  });

  it('reads a Herdr status word as the operator observation', async () => {
    const working = createHerdrPane({
      workspaceId: 'w',
      exec: async () => ({
        code: 0,
        stdout: '{"agent_status":"working"}',
        stderr: '',
      }),
    });
    expect(await working.read('n')).toEqual({ operator: 'working' });
    const gone = createHerdrPane({
      workspaceId: 'w',
      exec: async () => ({ code: 1, stdout: '', stderr: 'not found' }),
    });
    expect(await gone.read('n')).toEqual({ operator: 'gone' });
  });

  it('reads a string field of a Herdr answer', () => {
    expect(findJsonString('{"pane_id":"abc"}', 'pane_id')).toBe('abc');
    expect(findJsonString('{}', 'pane_id')).toBeUndefined();
  });
});
