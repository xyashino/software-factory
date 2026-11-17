import { execFile } from 'node:child_process';
import type {
  LaunchSpec,
  PaneDriver,
  PaneLocation,
  PaneReading,
} from '../ports';
import { acceptClaudeTrust, claudeConfigPathOf } from './claude-trust';

// How long the agent takes to leave its startup screen after Enter.
const STARTUP_WAIT_MS = 3000;

const TRUST_SCREEN =
  /Do you trust the contents of this project\?[\s\S]*Yes, I trust this folder/;

/** One call to the Herdr CLI: the arguments, and what it printed and returned. */
export interface HerdrOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

export type HerdrExec = (args: readonly string[]) => Promise<HerdrOutcome>;

/** The real Herdr call: the `herdr` binary, argument vector, no shell. */
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

/** A JSON string field of a Herdr answer, read without a full parse. */
export const findJsonString = (
  text: string,
  key: string,
): string | undefined => {
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(text);
  return match?.[1];
};

/** The Mechanic's panes are named `mechanic_<hash>_<n>`; every other pane is an Operator's. */
type Lane = 'operator' | 'mechanic';
const laneOf = (name: string): Lane =>
  name.split('_')[0] === 'mechanic' ? 'mechanic' : 'operator';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const workspaceIdOf = (answer: string, label: string): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.result)) return undefined;
  const listed = parsed.result.workspaces;
  if (!Array.isArray(listed)) return undefined;
  const items: unknown[] = listed;
  for (const item of items) {
    if (
      isRecord(item) &&
      item.label === label &&
      typeof item.workspace_id === 'string'
    )
      return item.workspace_id;
  }
  return undefined;
};

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

const envArgs = (env: Readonly<Record<string, string>>): string[] =>
  Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);

/**
 * Runs the Operator in a Herdr pane: one workspace per task, a tab for the Operator in it,
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
  const tabs = new Map<string, { tabId: string; task?: string; lane: Lane }>();
  const workspaces = new Map<string, string>();

  /** The task's workspace as Herdr lists it by label: it survives a Cell restart, the cache does not. */
  const listedWorkspaceOf = async (
    task: string,
  ): Promise<string | undefined> => {
    const listed = await exec(['workspace', 'list']);
    return listed.code === 0 ? workspaceIdOf(listed.stdout, task) : undefined;
  };

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
    const listed = await listedWorkspaceOf(task);
    if (listed !== undefined) {
      workspaces.set(task, listed);
      return listed;
    }
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
      // The workspace's first tab is the task's `logs` tab. Cosmetic: a failure here is not an error.
      const tabId = findJsonString(created.stdout, 'tab_id');
      const paneId = findJsonString(created.stdout, 'pane_id');
      try {
        if (tabId !== undefined) await ok(['tab', 'rename', tabId, 'logs']);
        // Clear the screen and scrollback, then exec the follower, so no echoed command is left above it.
        const clearAndRun = `printf '\\033[2J\\033[3J\\033[H' && exec ${logCommand}`;
        if (paneId !== undefined)
          await ok(['pane', 'run', paneId, clearAndRun]);
      } catch {
        // the logs tab is cosmetic
      }
    }
    return workspaceId;
  };

  return {
    open: async (
      spec: LaunchSpec & { name: string; task: string; logCommand?: string },
    ): Promise<PaneLocation> => {
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
      // At most one tab per lane of a task: the earlier one of this lane makes way for the new one.
      const lane = laneOf(spec.name);
      for (const [name, tab] of tabs) {
        if (tab.task === spec.task && tab.lane === lane) {
          tabs.delete(name);
          await exec(['tab', 'close', tab.tabId]);
        }
      }
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
      tabs.set(spec.name, { tabId, task: spec.task, lane });
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
        // A trust screen stops the start (`blocked during startup`): confirm it, then go on.
        const startupBlock =
          error instanceof Error &&
          error.message.includes('blocked during startup');
        if (!startupBlock || !(await confirmTrustOf(spec.name))) throw error;
        await new Promise((resolve) => setTimeout(resolve, STARTUP_WAIT_MS));
      }
      return { tabId };
    },
    adopt: (name, location) => {
      tabs.set(name, { tabId: location.tabId, lane: laneOf(name) });
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
      const workspaceId =
        workspaces.get(task) ?? (await listedWorkspaceOf(task));
      workspaces.delete(task);
      if (workspaceId !== undefined)
        await exec(['workspace', 'close', workspaceId]);
    },
    close: async (name) => {
      const tab = tabs.get(name);
      tabs.delete(name);
      if (tab !== undefined) await exec(['tab', 'close', tab.tabId]);
    },
  };
};
