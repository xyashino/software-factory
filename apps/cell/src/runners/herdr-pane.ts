import { execFile } from 'node:child_process';
import type { LaunchSpec, PaneDriver, PaneReading } from '../ports';
import { acceptClaudeTrust, claudeConfigPathOf } from './claude-trust';

/** How long the agent takes to leave its startup screen after Enter, as v1 waited. */
const STARTUP_WAIT_MS = 3000;

/** The folder-trust screen of Antigravity (`agy`), as v1 matched it. */
const TRUST_SCREEN =
  /Do you trust the contents of this project\?[\s\S]*Yes, I trust this folder/;

/** One call to the Herdr CLI: the arguments, and what it printed and returned. */
export interface HerdrOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

export type HerdrExec = (args: readonly string[]) => Promise<HerdrOutcome>;

/** The real Herdr call: the `herdr` binary, argument vector, no shell (v1 adapter surface). */
export const execHerdr: HerdrExec = (args) =>
  new Promise<HerdrOutcome>((resolve) => {
    execFile(
      'herdr',
      [...args],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

/** A JSON string field of a Herdr answer, read without a full parse (v1 `findJsonString`). */
export const findJsonString = (
  text: string,
  key: string,
): string | undefined => {
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(text);
  return match?.[1];
};

/** Herdr's agent status words, mapped to what the watch needs (CORE §9.1). */
const toOperator = (status: string | undefined): PaneReading['operator'] => {
  switch (status) {
    case 'working':
      return 'working';
    case 'idle':
    case 'done':
      return 'idle';
    case 'blocked':
      return 'blocked';
    case 'gone':
      return 'gone';
    default:
      return 'unknown';
  }
};

/** One `--env KEY=VALUE` pair per variable, each one argument, unquoted: Herdr receives it verbatim. */
const envArgs = (env: Readonly<Record<string, string>>): string[] =>
  Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);

/**
 * Runs the Operator in a Herdr pane: one workspace per task (as v1 did), a tab for the Operator in it,
 * the agent, the typed text, the read and the close.
 */
export const createHerdrPane = (
  options: { exec?: HerdrExec; claudeConfigPath?: string } = {},
): PaneDriver => {
  const exec = options.exec ?? execHerdr;
  const ok = async (args: readonly string[]): Promise<HerdrOutcome> => {
    const outcome = await exec(args);
    if (outcome.code !== 0) {
      throw new Error(
        `herdr ${args[0]} ${args[1] ?? ''} failed: ${outcome.stderr.trim() || outcome.stdout.trim()}`,
      );
    }
    return outcome;
  };
  const tabs = new Map<string, string>();
  const workspaces = new Map<string, string>();

  /** Presses Enter on the folder-trust screen of an agent, if that is what it shows. */
  const confirmTrustOf = async (name: string): Promise<boolean> => {
    const screen = await exec(['agent', 'read', name, '--source', 'visible']);
    if (screen.code !== 0 || !TRUST_SCREEN.test(screen.stdout)) return false;
    await ok(['agent', 'send-keys', name, 'Enter']);
    return true;
  };

  /** The task's workspace, created on its first Operator and kept for the rest of the task. */
  const workspaceOf = async (
    task: string,
    cwd: string,
    logCommand: string | undefined,
  ): Promise<string> => {
    const known = workspaces.get(task);
    if (known !== undefined) return known;
    const created = await ok([
      'workspace',
      'create',
      '--cwd',
      cwd,
      '--label',
      task,
      '--no-focus',
    ]);
    const workspaceId = findJsonString(created.stdout, 'workspace_id');
    if (workspaceId === undefined) {
      throw new Error('herdr workspace create returned no workspace_id');
    }
    workspaces.set(task, workspaceId);
    if (logCommand !== undefined) {
      // The workspace's first tab is the task's `logs` tab, as in v1. Cosmetic: a failure here is not an error.
      const tabId = findJsonString(created.stdout, 'tab_id');
      const paneId = findJsonString(created.stdout, 'pane_id');
      try {
        if (tabId !== undefined) await ok(['tab', 'rename', tabId, 'logs']);
        if (paneId !== undefined) await ok(['pane', 'run', paneId, logCommand]);
      } catch {
        // the logs tab is cosmetic
      }
    }
    return workspaceId;
  };

  return {
    open: async (
      spec: LaunchSpec & { name: string; task: string; logCommand?: string },
    ) => {
      // Claude Code shows its trust dialog for every new folder; its flag is set before the start.
      if (spec.command[0] === 'claude') {
        acceptClaudeTrust(
          options.claudeConfigPath ?? claudeConfigPathOf(),
          spec.cwd,
        );
      }
      const env = envArgs(spec.env);
      const workspaceId = await workspaceOf(
        spec.task,
        spec.cwd,
        spec.logCommand,
      );
      const created = await ok([
        'tab',
        'create',
        '--workspace',
        workspaceId,
        '--cwd',
        spec.cwd,
        '--label',
        spec.name,
        '--no-focus',
        ...env,
      ]);
      const tabId = findJsonString(created.stdout, 'tab_id');
      const paneId = findJsonString(created.stdout, 'pane_id');
      if (tabId === undefined || paneId === undefined) {
        throw new Error('herdr tab create returned no tab_id or pane_id');
      }
      tabs.set(spec.name, tabId);
      const [binary, ...args] = spec.command;
      if (binary === undefined) throw new Error('pane launch names no command');
      try {
        await ok([
          'agent',
          'start',
          spec.name,
          '--kind',
          binary,
          '--pane',
          paneId,
          '--timeout',
          '60000',
          '--',
          ...args,
        ]);
      } catch (error) {
        // A trust screen stops the start (`blocked during startup`): confirm it, as v1 did, then go on.
        const startupBlock =
          error instanceof Error &&
          error.message.includes('blocked during startup');
        if (!startupBlock || !(await confirmTrustOf(spec.name))) throw error;
        await new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS));
      }
    },
    type: async (name, text) => {
      // Waits until the agent starts working, or stops on a prompt, so the text is not lost while the TUI
      // is still starting. `idle` is left out: an agent sitting at an empty prompt answers it at once.
      await ok([
        'agent',
        'prompt',
        name,
        text,
        '--wait',
        '--until',
        'working',
        '--until',
        'blocked',
        '--timeout',
        '30000',
      ]);
      // The prompt can be pasted into the input without being sent: submit it with Enter.
      await ok(['agent', 'send-keys', name, 'Enter']);
    },
    read: async (name): Promise<PaneReading> => {
      const outcome = await exec(['agent', 'get', name]);
      if (outcome.code !== 0) return { operator: 'gone' };
      return {
        operator: toOperator(
          findJsonString(outcome.stdout, 'agent_status') ??
            findJsonString(outcome.stdout, 'status'),
        ),
      };
    },
    tail: async (name) => {
      const outcome = await exec(['agent', 'read', name, '--source', 'recent']);
      return outcome.code === 0 ? outcome.stdout.slice(-2048) : '';
    },
    confirmTrust: confirmTrustOf,
    closeTask: async (task) => {
      const workspaceId = workspaces.get(task);
      workspaces.delete(task);
      if (workspaceId !== undefined)
        await exec(['workspace', 'close', workspaceId]);
    },
    close: async (name) => {
      const tab = tabs.get(name);
      tabs.delete(name);
      if (tab !== undefined) await exec(['tab', 'close', tab]);
    },
  };
};
