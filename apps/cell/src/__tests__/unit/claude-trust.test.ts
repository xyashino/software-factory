import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acceptClaudeTrust } from '../../runners/claude-trust';
import {
  createHerdrPane,
  type HerdrExec,
  type HerdrOutcome,
} from '../../runners/herdr-pane';

let root: string;
let config: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-trust-'));
  config = join(root, '.claude.json');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const read = (): Record<string, unknown> =>
  JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;

describe('claude trust in its config', () => {
  it('creates the file when it is missing, with the folder trusted', () => {
    acceptClaudeTrust(config, '/work/a');
    expect(read()).toEqual({
      projects: { '/work/a': { hasTrustDialogAccepted: true } },
    });
  });

  it('keeps every other field and project when it adds the folder', () => {
    writeFileSync(
      config,
      JSON.stringify({
        numStartups: 4,
        projects: { '/home/x': { allowedTools: ['Read'] } },
      }),
    );
    acceptClaudeTrust(config, '/work/a');
    expect(read()).toEqual({
      numStartups: 4,
      projects: {
        '/home/x': { allowedTools: ['Read'] },
        '/work/a': { hasTrustDialogAccepted: true },
      },
    });
  });

  it('does not rewrite a folder that is already trusted', () => {
    const text = JSON.stringify({
      projects: { '/work/a': { hasTrustDialogAccepted: true } },
    });
    writeFileSync(config, text);
    acceptClaudeTrust(config, '/work/a');
    expect(readFileSync(config, 'utf8')).toBe(text);
  });

  it('a claude open trusts its folder before the agent starts', async () => {
    const calls: string[][] = [];
    const exec: HerdrExec = async (args): Promise<HerdrOutcome> => {
      calls.push([...args]);
      if (args[0] === 'workspace')
        return { code: 0, stdout: '{"workspace_id":"w1"}', stderr: '' };
      if (args[0] === 'tab')
        return {
          code: 0,
          stdout: '{"tab_id":"t1","pane_id":"p1"}',
          stderr: '',
        };
      return { code: 0, stdout: '', stderr: '' };
    };
    const pane = createHerdrPane({ exec, claudeConfigPath: config });
    await pane.open({
      name: 'build_1',
      task: 'todo-a',
      command: ['claude', '--model', 'sonnet'],
      cwd: '/work/a',
      env: {},
      stdoutPath: '/o',
      stderrPath: '/e',
    });
    expect(read()).toEqual({
      projects: { '/work/a': { hasTrustDialogAccepted: true } },
    });
  });
});

describe('the trust screen of the pane driver', () => {
  const screenExec = (screen: string) => {
    const calls: string[][] = [];
    const exec: HerdrExec = async (args) => {
      calls.push([...args]);
      if (args[0] === 'agent' && args[1] === 'read')
        return { code: 0, stdout: screen, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    return { calls, exec };
  };

  it('presses Enter on the Antigravity trust screen', async () => {
    const { calls, exec } = screenExec(
      'Do you trust the contents of this project?\n> Yes, I trust this folder\n  No',
    );
    const pane = createHerdrPane({ exec, claudeConfigPath: config });
    expect(await pane.confirmTrust('agy_1')).toBe(true);
    expect(calls.at(-1)).toEqual(['agent', 'send-keys', 'agy_1', 'Enter']);
  });

  it('does nothing on any other screen', async () => {
    const { calls, exec } = screenExec('> Working on the build...');
    const pane = createHerdrPane({ exec, claudeConfigPath: config });
    expect(await pane.confirmTrust('agy_1')).toBe(false);
    expect(calls.some((c) => c.includes('send-keys'))).toBe(false);
  });
});

describe('a trust screen that stops the agent start', () => {
  const launch = {
    name: 'audit_1',
    task: 'todo-a',
    command: ['agy', '--mode', 'auto'],
    cwd: '/work/a',
    env: {},
    stdoutPath: '/o',
    stderrPath: '/e',
  };
  const startFailing = (screen: string) => {
    const calls: string[][] = [];
    const exec: HerdrExec = async (args): Promise<HerdrOutcome> => {
      calls.push([...args]);
      if (args[0] === 'workspace')
        return { code: 0, stdout: '{"workspace_id":"w1"}', stderr: '' };
      if (args[0] === 'tab')
        return {
          code: 0,
          stdout: '{"tab_id":"t1","pane_id":"p1"}',
          stderr: '',
        };
      if (args[0] === 'agent' && args[1] === 'start')
        return {
          code: 1,
          stdout:
            '{"error":{"message":"agent audit_1 is blocked during startup and is not ready for prompts"}}',
          stderr: '',
        };
      if (args[0] === 'agent' && args[1] === 'read')
        return { code: 0, stdout: screen, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    return { calls, exec };
  };

  it('presses Enter on the trust screen and opens the pane', async () => {
    const { calls, exec } = startFailing(
      'Do you trust the contents of this project?\n> Yes, I trust this folder\n  No, exit',
    );
    const pane = createHerdrPane({ exec, claudeConfigPath: config });
    await expect(pane.open(launch)).resolves.toBeUndefined();
    expect(calls.at(-1)).toEqual(['agent', 'send-keys', 'audit_1', 'Enter']);
  });

  it('rethrows the start error when the screen is not the trust screen', async () => {
    const { exec } = startFailing('something else entirely');
    const pane = createHerdrPane({ exec, claudeConfigPath: config });
    await expect(pane.open(launch)).rejects.toThrow(/blocked during startup/);
  });
});

describe('typing into a pane', () => {
  it('submits the text with Enter after the agent takes it', async () => {
    const calls: string[][] = [];
    const exec: HerdrExec = async (args) => {
      calls.push([...args]);
      return { code: 0, stdout: '', stderr: '' };
    };
    const pane = createHerdrPane({ exec, claudeConfigPath: config });
    await pane.type('plan-review_1', 'Read prompt.md and follow it');
    expect(calls.at(-2)?.[0]).toBe('agent');
    expect(calls.at(-2)?.[1]).toBe('prompt');
    expect(calls.at(-1)).toEqual([
      'agent',
      'send-keys',
      'plan-review_1',
      'Enter',
    ]);
  });
});

describe('the logs tab of a task workspace', () => {
  it('renames the first tab to logs and runs the log command there', async () => {
    const calls: string[][] = [];
    const exec: HerdrExec = async (args) => {
      calls.push([...args]);
      if (args[0] === 'workspace')
        return {
          code: 0,
          stdout: '{"workspace_id":"w9","tab_id":"w9:t1","pane_id":"w9:p1"}',
          stderr: '',
        };
      return { code: 0, stdout: '{"tab_id":"t2","pane_id":"p2"}', stderr: '' };
    };
    const pane = createHerdrPane({ exec, claudeConfigPath: config });
    await pane.open({
      name: 'build_1',
      task: 'todo-a',
      logCommand: 'bun cli.ts log software-factory:todo-a -f',
      command: ['sh', '-c', 'true'],
      cwd: '/work/a',
      env: {},
      stdoutPath: '/o',
      stderrPath: '/e',
    });
    expect(calls).toContainEqual(['tab', 'rename', 'w9:t1', 'logs']);
    expect(calls).toContainEqual([
      'pane',
      'run',
      'w9:p1',
      `printf '\\033[2J\\033[3J\\033[H' && exec bun cli.ts log software-factory:todo-a -f`,
    ]);
  });
});
