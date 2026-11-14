import { describe, expect, it } from 'vitest';
import {
  createHerdrAdapter,
  findJsonString,
  type HerdrOutcome,
} from '../herdr.adapter';

type Reply = Partial<HerdrOutcome>;

/** Replays scripted replies in order and records every argument list. */
const scripted = (replies: Reply[]) => {
  const calls: string[][] = [];
  const exec = async (args: string[]): Promise<HerdrOutcome> => {
    calls.push(args);
    const reply = replies.shift() ?? {};
    return { code: 0, stdout: '', stderr: '', ...reply };
  };
  return { calls, exec };
};

describe('herdr adapter', () => {
  it('creates a workspace and reads its id from the JSON reply', async () => {
    const fake = scripted([
      {
        stdout:
          '{"result":{"workspace":{"workspace_id":"w_1"},"tab":{"tab_id":"t_1"},"root_pane":{"pane_id":"p_1"}}}',
      },
    ]);
    const herdr = createHerdrAdapter(fake.exec);
    await expect(herdr.createWorkspace('task-1', '/repo')).resolves.toEqual({
      workspaceId: 'w_1',
      tabId: 't_1',
      paneId: 'p_1',
    });
    expect(fake.calls[0]).toEqual([
      'workspace',
      'create',
      '--cwd',
      '/repo',
      '--label',
      'task-1',
      '--no-focus',
    ]);
  });

  it('renames a tab via herdr tab rename', async () => {
    const fake = scripted([{}]);
    const herdr = createHerdrAdapter(fake.exec);
    await herdr.renameTab('t_1', 'logs');
    expect(fake.calls[0]).toEqual(['tab', 'rename', 't_1', 'logs']);
  });

  it('runs a command in a pane via herdr pane run', async () => {
    const fake = scripted([{}]);
    const herdr = createHerdrAdapter(fake.exec);
    await herdr.runPane('p_1', 'tail -f file.log');
    expect(fake.calls[0]).toEqual(['pane', 'run', 'p_1', 'tail -f file.log']);
  });

  it('reports an existing workspace when workspace get succeeds', async () => {
    const fake = scripted([{ stdout: '{"result":{"workspace":{}}}' }]);
    const herdr = createHerdrAdapter(fake.exec);
    await expect(herdr.workspaceExists('w_1')).resolves.toBe(true);
    expect(fake.calls[0]).toEqual(['workspace', 'get', 'w_1']);
  });

  it('reports an absent workspace on workspace_not_found', async () => {
    const fake = scripted([
      {
        code: 1,
        stdout: '{"error":{"code":"workspace_not_found","message":"gone"}}',
      },
    ]);
    const herdr = createHerdrAdapter(fake.exec);
    await expect(herdr.workspaceExists('w_1')).resolves.toBe(false);
  });

  it('throws on any other workspace get failure so nothing is recreated', async () => {
    const fake = scripted([{ code: 1, stderr: 'cannot connect to socket' }]);
    const herdr = createHerdrAdapter(fake.exec);
    await expect(herdr.workspaceExists('w_1')).rejects.toThrow(
      'workspace get failed',
    );
  });

  it('passes every FACTORY_* variable and the PATH as --env flags on tab create', async () => {
    const fake = scripted([{ stdout: '{"tab_id":"t_1","pane_id":"p_1"}' }]);
    const herdr = createHerdrAdapter(fake.exec);
    const tab = await herdr.createTab({
      workspaceId: 'w_1',
      label: 'build#1',
      cwd: '/repo/.worktrees/task-1',
      env: {
        FACTORY_ROOT: '/repo',
        FACTORY_TASK: 'task-1',
        PATH: '/pkg/bin:/usr/bin',
      },
    });
    expect(tab).toEqual({ tabId: 't_1', paneId: 'p_1' });
    expect(fake.calls[0]).toEqual([
      'tab',
      'create',
      '--workspace',
      'w_1',
      '--cwd',
      '/repo/.worktrees/task-1',
      '--label',
      'build#1',
      '--no-focus',
      '--env',
      'FACTORY_ROOT=/repo',
      '--env',
      'FACTORY_TASK=task-1',
      '--env',
      'PATH=/pkg/bin:/usr/bin',
    ]);
  });

  it('starts an agent with its runner arguments after the separator', async () => {
    const fake = scripted([{}]);
    await createHerdrAdapter(fake.exec).startAgent({
      name: 'build#1',
      kind: 'claude',
      paneId: 'p_1',
      args: ['--model', 'sonnet'],
      timeoutMs: 60_000,
    });
    expect(fake.calls[0]).toEqual([
      'agent',
      'start',
      'build#1',
      '--kind',
      'claude',
      '--pane',
      'p_1',
      '--timeout',
      '60000',
      '--',
      '--model',
      'sonnet',
    ]);
  });

  it('maps wait replies to observations and timeouts', async () => {
    const fake = scripted([
      { stdout: '{"agent_status":"idle"}' },
      { code: 1, stderr: '{"code":"timeout"}' },
      { code: 1, stderr: 'agent not found' },
    ]);
    const herdr = createHerdrAdapter(fake.exec);
    expect(await herdr.wait('build#1', 2000)).toBe('idle');
    expect(await herdr.wait('build#1', 2000)).toBe('timeout');
    expect(await herdr.wait('build#1', 2000)).toBe('unknown');
  });

  it('returns empty string when reading a missing agent', async () => {
    const fake = scripted([
      {
        code: 1,
        stderr:
          '{"error":{"code":"agent_not_found","message":"agent target not found"}}',
      },
    ]);
    expect(await createHerdrAdapter(fake.exec).read('build#1', 200)).toBe('');
  });

  it('reports a blocked prompt instead of failing', async () => {
    const fake = scripted([{ code: 1, stderr: 'agent_blocked' }]);
    expect(await createHerdrAdapter(fake.exec).prompt('build#1', 'go')).toBe(
      'blocked',
    );
  });

  it('treats a missing tab on close as absent', async () => {
    const fake = scripted([{ code: 1, stderr: 'tab not found' }]);
    expect(await createHerdrAdapter(fake.exec).closeTab('t_9')).toBe('absent');
  });

  it('shows a notification with its body and sound', async () => {
    const fake = scripted([{}]);

    await createHerdrAdapter(fake.exec).notify('Task Delivered: t1', {
      body: 'https://example.test/pull/1',
      sound: 'done',
    });

    expect(fake.calls[0]).toEqual([
      'notification',
      'show',
      'Task Delivered: t1',
      '--body',
      'https://example.test/pull/1',
      '--sound',
      'done',
    ]);
  });

  it('omits notification flags that were not given', async () => {
    const fake = scripted([{}, {}]);
    const herdr = createHerdrAdapter(fake.exec);

    await herdr.notify('Hello');
    await herdr.notify('Placed', { position: 'top-left' });

    expect(fake.calls).toEqual([
      ['notification', 'show', 'Hello'],
      ['notification', 'show', 'Placed', '--position', 'top-left'],
    ]);
  });

  it('throws when herdr refuses the notification', async () => {
    const fake = scripted([{ code: 1, stderr: 'no server' }]);

    await expect(createHerdrAdapter(fake.exec).notify('Hello')).rejects.toThrow(
      'no server',
    );
  });

  it('finds keys nested anywhere in the reply', () => {
    expect(findJsonString('{"a":[{"b":{"pane_id":"p"}}]}', 'pane_id')).toBe(
      'p',
    );
    expect(findJsonString('not json', 'pane_id')).toBeUndefined();
  });

  it('reports a live agent as existing', async () => {
    const fake = scripted([{ stdout: '{"result":{"type":"agent_info"}}' }]);
    const herdr = createHerdrAdapter(fake.exec);
    await expect(herdr.exists('agent_1')).resolves.toBe(true);
  });

  it('reports a missing agent as absent on agent_not_found', async () => {
    const fake = scripted([
      {
        code: 1,
        stdout:
          '{"error":{"code":"agent_not_found","message":"agent target agent_1 not found"}}',
      },
    ]);
    const herdr = createHerdrAdapter(fake.exec);
    await expect(herdr.exists('agent_1')).resolves.toBe(false);
  });

  it('throws on any other agent get failure instead of reporting the agent dead', async () => {
    const fake = scripted([{ code: 1, stderr: 'cannot connect to socket' }]);
    const herdr = createHerdrAdapter(fake.exec);
    await expect(herdr.exists('agent_1')).rejects.toThrow('agent get failed');
  });
});
