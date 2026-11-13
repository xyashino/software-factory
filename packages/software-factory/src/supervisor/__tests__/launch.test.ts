import { describe, expect, it } from 'vitest';
import type { AgentDef } from '../../definitions/types';
import { launchAgent } from '../launch';
import { harness, scratchRoot } from './fixtures';

const AGENT: AgentDef = {
  role: 'doctor',
  runner: 'claude',
  model: 'sonnet',
  timeoutMs: 60_000,
  headless: false,
  permission: 'write',
};

const TRUST_SCREEN = [
  'Accessing workspace:',
  '/home/x/.worktrees/task',
  '',
  'Do you trust the contents of this project?',
  '',
  'Antigravity CLI requires permission to read, edit,',
  'and execute files here.',
  '',
  '> Yes, I trust this folder',
  '  No, exit',
].join('\n');

const launch = (h: ReturnType<typeof harness>) => {
  return launchAgent(h.ports, {
    taskId: 'task-1',
    attemptId: 'attempt-1',
    agent: AGENT,
    name: 'task_audit_1',
    tab: 'audit#1',
    worktree: '/tmp/task',
    promptPath: '/tmp/prompt.md',
    evidenceDir: '/tmp/evidence',
  });
};

const NOT_READY = new Error(
  'herdr agent start task_audit_1 failed: {"error":{"code":"agent_not_ready","message":"blocked during startup"}}',
);

describe('launchAgent startup trust prompt', () => {
  it('confirms the folder-trust screen and then sends the kickoff prompt', async () => {
    const h = harness(scratchRoot({}));
    h.herdr.startError = NOT_READY;
    h.herdr.screenText = TRUST_SCREEN;

    await expect(launch(h)).resolves.toEqual({
      tabId: 'tab-audit#1',
      paneId: 'pane-audit#1',
    });

    const methods = h.herdr.calls.map((call) => call.method);
    expect(methods).toContain('readScreen');
    expect(
      h.herdr.calls.find((call) => call.method === 'sendKeys')?.args,
    ).toEqual(['task_audit_1', 'Enter']);
    expect(methods.indexOf('sendKeys')).toBeLessThan(methods.indexOf('prompt'));
  });

  it('keeps the original start error when the blocked screen is not the trust prompt', async () => {
    const h = harness(scratchRoot({}));
    h.herdr.startError = NOT_READY;
    h.herdr.screenText = 'Loading model...';

    await expect(launch(h)).rejects.toThrow('agent_not_ready');
    expect(h.herdr.calls.some((call) => call.method === 'sendKeys')).toBe(
      false,
    );
    expect(h.herdr.calls.some((call) => call.method === 'prompt')).toBe(false);
  });

  it('does not touch the screen for start errors other than a blocked startup', async () => {
    const h = harness(scratchRoot({}));
    h.herdr.startError = new Error('herdr refused the agent');

    await expect(launch(h)).rejects.toThrow('herdr refused the agent');
    expect(h.herdr.calls.some((call) => call.method === 'readScreen')).toBe(
      false,
    );
  });
});

describe('launchAgent kickoff prompt on a trust screen', () => {
  it('confirms a trust screen that appears after the start and sends the kickoff again', async () => {
    const h = harness(scratchRoot({}));
    h.herdr.screenText = TRUST_SCREEN;
    let calls = 0;
    const prompt = h.herdr.prompt.bind(h.herdr);
    h.herdr.prompt = async (name, text) => {
      calls += 1;
      return calls === 1 ? 'blocked' : prompt(name, text);
    };

    await expect(launch(h)).resolves.toMatchObject({ paneId: 'pane-audit#1' });
    expect(calls).toBe(2);
    expect(h.herdr.calls.some((call) => call.method === 'sendKeys')).toBe(true);
  });

  it('fails with the screen text when the blocked prompt is not a trust screen', async () => {
    const h = harness(scratchRoot({}));
    h.herdr.screenText = 'Allow command "rm -rf build"? (y/n)';
    h.herdr.prompt = async () => 'blocked';

    await expect(launch(h)).rejects.toThrow('Allow command');
    expect(h.herdr.calls.some((call) => call.method === 'sendKeys')).toBe(
      false,
    );
  });
});
