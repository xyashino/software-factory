import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tick } from '../run';
import { harness, scratchRoot, todoText, type Harness } from './fixtures';

const calls = (h: Harness, method: string): number => {
  return h.herdr.calls.filter((call) => call.method === method).length;
};

const tabs = (h: Harness) => {
  return h.herdr.calls
    .filter((call) => call.method === 'createTab')
    .map(
      (call) =>
        call.args[0] as {
          workspaceId: string;
          label: string;
          cwd: string;
          env: Record<string, string>;
        },
    );
};

const agentTab = (h: Harness) => {
  return tabs(h).find((tab) => tab.label !== 'cli');
};

const untilAgentStarts = async (h: Harness): Promise<void> => {
  for (let i = 0; i < 20 && agentTab(h) === undefined; i++) {
    await tick(h.ports, () => undefined);
  }
};

const attemptFailures = (h: Harness) => {
  return h.store
    .events('hello')
    .flatMap((stored) =>
      stored.event.type === 'attempt_failed' ? [stored.event] : [],
    );
};

describe('workspace recovery', () => {
  it('replaces a registry workspace Herdr no longer has, before the attempt', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.ports.workspaces.set('hello', 'ws-old');
    h.herdr.missingWorkspaces.add('ws-old');

    await untilAgentStarts(h);

    expect(calls(h, 'createWorkspace')).toBe(1);
    expect(h.ports.workspaces.get('hello')).toBe('ws-hello');
    expect(calls(h, 'renameTab')).toBe(1);
    expect(
      h.herdr.calls.find((call) => call.method === 'renameTab')?.args,
    ).toEqual(['tab-hello-init', 'logs']);
    expect(calls(h, 'runPane')).toBe(1);
    const runPaneCall = h.herdr.calls.find((call) => call.method === 'runPane');
    expect(runPaneCall?.args[0]).toBe('pane-hello-init');
    const paneCommand = String(runPaneCall?.args[1]);
    expect(paneCommand).toContain("printf '\\033[2J\\033[3J\\033[H'");
    expect(paneCommand).toContain('exec tail -n +1 -f');
    expect(
      existsSync(join(root, '.evidences', 'hello', 'supervisor.log')),
    ).toBe(true);

    expect(agentTab(h)).toMatchObject({ workspaceId: 'ws-hello' });
    expect(calls(h, 'closeWorkspace')).toBe(0);
    expect(attemptFailures(h)).toEqual([]);
    expect(h.store.tasks()[0]?.status).not.toBe('blocked');
    const attemptId = h.store
      .events('hello')
      .flatMap((stored) =>
        stored.event.type === 'attempt_started' ? [stored.event.attemptId] : [],
      )[0];
    const log = readFileSync(
      join(root, '.evidences', 'hello', attemptId ?? '', 'workspace.log'),
      'utf8',
    );
    expect(log).toContain('ws-old');
    expect(log).toContain('ws-hello');
  });

  it('reuses an existing registry workspace without creating another', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.ports.workspaces.set('hello', 'ws-live');

    await untilAgentStarts(h);

    expect(calls(h, 'workspaceExists')).toBeGreaterThan(0);
    expect(calls(h, 'createWorkspace')).toBe(0);
    expect(h.ports.workspaces.get('hello')).toBe('ws-live');
    expect(agentTab(h)).toMatchObject({ workspaceId: 'ws-live' });
  });

  it('reuses an existing workspace without opening another cli tab', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.ports.workspaces.set('hello', 'ws-live');

    await untilAgentStarts(h);

    expect(tabs(h).filter((tab) => tab.label === 'cli')).toEqual([]);
  });

  it('opens a cli shell tab in the task worktree next to logs on a new workspace', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);

    await untilAgentStarts(h);

    const cli = tabs(h).filter((tab) => tab.label === 'cli');
    expect(cli).toHaveLength(1);
    expect(cli[0]?.workspaceId).toBe('ws-hello');
    expect(cli[0]?.cwd).toBe(agentTab(h)?.cwd);
    expect(cli[0]?.env.FACTORY_TASK).toBe('hello');
    expect(cli[0]?.env.FACTORY_ROOT).toBe(root);
    expect(cli[0]?.env.FACTORY_ATTEMPT).toBeUndefined();
    expect(cli[0]?.env.PATH?.startsWith('/')).toBe(true);
    expect(tabs(h)[0]?.label).toBe('cli');
    expect(calls(h, 'renameTab')).toBe(1);
  });

  it('does not start an agent in the cli tab', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);

    await untilAgentStarts(h);

    const starts = h.herdr.calls
      .filter((call) => call.method === 'startAgent')
      .map((call) => (call.args[0] as { paneId: string }).paneId);
    expect(starts).not.toContain('pane-cli');
  });

  it('keeps the task running when the cli tab cannot be opened', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    const createTab = h.herdr.createTab.bind(h.herdr);
    h.herdr.createTab = async (input) => {
      if (input.label === 'cli') throw new Error('herdr refused tab');
      return createTab(input);
    };

    await untilAgentStarts(h);

    expect(agentTab(h)).toBeDefined();
    expect(attemptFailures(h)).toEqual([]);
  });

  it('fails the start and creates nothing when Herdr errors for another reason', async () => {
    const root = scratchRoot({ 'hello.md': todoText('todo') });
    const h = harness(root);
    h.ports.workspaces.set('hello', 'ws-old');
    h.herdr.workspaceExists = async () => {
      throw new Error('herdr server is down');
    };

    for (let i = 0; i < 20 && attemptFailures(h).length === 0; i++) {
      await tick(h.ports, () => undefined);
    }

    expect(attemptFailures(h)[0]).toMatchObject({
      reason: 'start_failed',
      detail: 'herdr server is down',
    });
    expect(calls(h, 'createWorkspace')).toBe(0);
    expect(h.ports.workspaces.get('hello')).toBe('ws-old');
  });
});
