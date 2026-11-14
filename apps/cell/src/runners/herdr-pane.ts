import { execFile } from 'node:child_process';
import type { LaunchSpec, PaneDriver, PaneReading } from '../ports';

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

/** Runs the Operator in a Herdr pane: the tab, the agent, the typed text, the read and the close. */
export const createHerdrPane = (options: {
  workspaceId: string;
  exec?: HerdrExec;
}): PaneDriver => {
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

  return {
    open: async (spec: LaunchSpec & { name: string }) => {
      const env = envArgs(spec.env);
      const created = await ok([
        'tab',
        'create',
        '--workspace',
        options.workspaceId,
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
    },
    type: async (name, text) => {
      await ok(['agent', 'prompt', name, text]);
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
    close: async (name) => {
      const tab = tabs.get(name);
      tabs.delete(name);
      if (tab !== undefined) await exec(['tab', 'close', tab]);
    },
  };
};
