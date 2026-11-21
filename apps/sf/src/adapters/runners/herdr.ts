import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import type { ProcessPort } from '../../application/ports/process.port';
import type {
  RunHandle,
  RunnerPort,
  RunOutcome,
  RunSpec,
} from '../../application/ports/runner.port';
import {
  acceptAntigravityTrust,
  antigravitySettingsPathOf,
} from './antigravity-trust';
import { acceptClaudeTrust, claudeConfigPathOf } from './claude-trust';

const HERDR = 'herdr';
const CLAUDE = 'claude';
const ANTIGRAVITY = 'agy';
const POLL_MS = 1000;
const ABORTED_EXIT = 130;
const WORKSPACE_LABEL_PREFIX = 'factory:';
const LOGS_LABEL = 'logs';
const LOG_TAIL_LINES = 200;
const CLEAR_SCREEN = "printf '\\033[2J\\033[3J\\033[H'";
const TERM_WAIT_MS = 10_000;
const KILL_WAIT_MS = 5_000;
const TAB_ID = /"tab_id"\s*:\s*"([^"]+)"/;
const PANE_ID = /"pane_id"\s*:\s*"([^"]+)"/;
const WORKSPACE_ID = /"workspace_id"\s*:\s*"([^"]+)"/;
const PROCESS_ROW = /^\s*(\d+)\s+(\d+)\s*$/;

const workspaceListSchema = z.object({
  result: z.object({
    workspaces: z.array(
      z.object({ label: z.string().nullish(), workspace_id: z.string() }),
    ),
  }),
});

const tabListSchema = z.object({
  result: z.object({
    tabs: z.array(
      z.object({
        tab_id: z.string(),
        label: z.string().nullish(),
        number: z.number(),
      }),
    ),
  }),
});

const paneListSchema = z.object({
  result: z.object({
    panes: z.array(z.object({ pane_id: z.string(), tab_id: z.string() })),
  }),
});

export interface HerdrRunnerOptions {
  /** where the Cell workspace and its logs tab open */
  home: string;
  /** the Cell log the first tab follows */
  logPath: string;
}

interface HerdrRun {
  cwd: string;
  tabId: string;
  exitFile: string;
  pidFile: string;
  aborted: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

const launcherOf = (spec: RunSpec, exitFile: string, pidFile: string): string =>
  [
    '#!/bin/bash',
    `cd ${shellQuote(spec.cwd)} || exit 127`,
    `echo "$$" > ${shellQuote(pidFile)}`,
    ...Object.entries(spec.env).map(
      ([key, value]) => `export ${key}=${shellQuote(value)}`,
    ),
    [spec.command, ...spec.args].map(shellQuote).join(' ') +
      `; echo "$?" > ${shellQuote(exitFile)}`,
    '',
  ].join('\n');

const pidOf = (pidFile: string): number | undefined => {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10);
  return Number.isNaN(pid) ? undefined : pid;
};

const childrenOf = (
  table: readonly (readonly [number, number])[],
  parent: number,
): number[] => table.filter(([, ppid]) => ppid === parent).map(([pid]) => pid);

const treeOf = (
  table: readonly (readonly [number, number])[],
  root: number,
): number[] => {
  const found = new Set<number>([root]);
  const queue = [root];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const child of childrenOf(table, next)) {
      if (found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return [...found];
};

const processTableOf = async (
  processPort: ProcessPort,
  cwd: string,
): Promise<[number, number][]> => {
  const result = await processPort.run(
    'ps',
    ['-A', '-o', 'pid=', '-o', 'ppid='],
    cwd,
  );
  if (result.exitCode !== 0) return [];
  return result.stdout.split('\n').flatMap((line): [number, number][] => {
    const match = PROCESS_ROW.exec(line);
    return match === null ? [] : [[Number(match[1]), Number(match[2])]];
  });
};

const signalPids = async (
  processPort: ProcessPort,
  cwd: string,
  signal: 'TERM' | 'KILL',
  pids: readonly number[],
): Promise<void> => {
  if (pids.length === 0) return;
  await processPort.run('kill', [`-${signal}`, ...pids.map(String)], cwd);
};

const goneWithin = async (
  processPort: ProcessPort,
  pids: readonly number[],
  limitMs: number,
): Promise<boolean> => {
  for (let waited = 0; ; waited += POLL_MS) {
    if (!pids.some((pid) => processPort.isAlive(pid))) return true;
    if (waited >= limitMs) return false;
    await sleep(POLL_MS);
  }
};

// Herdr closing a tab does not end the agent behind it, so the launcher's process tree is signalled directly.
const stopTree = async (
  processPort: ProcessPort,
  run: HerdrRun,
): Promise<boolean> => {
  const root = pidOf(run.pidFile);
  if (root === undefined) return true;
  const known = new Set(
    treeOf(await processTableOf(processPort, run.cwd), root),
  );
  await signalPids(processPort, run.cwd, 'TERM', [...known]);
  if (await goneWithin(processPort, [...known], TERM_WAIT_MS)) return true;
  for (const pid of treeOf(await processTableOf(processPort, run.cwd), root)) {
    known.add(pid);
  }
  await signalPids(processPort, run.cwd, 'KILL', [...known]);
  return goneWithin(processPort, [...known], KILL_WAIT_MS);
};

const herdrOk = async (
  processPort: ProcessPort,
  args: readonly string[],
  cwd: string,
): Promise<string> => {
  const result = await processPort.run(HERDR, args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `herdr ${args[0]} ${args[1] ?? ''} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
};

const cellWorkspaceOf = async (
  processPort: ProcessPort,
  cellName: string,
  cwd: string,
): Promise<string> => {
  const label = `${WORKSPACE_LABEL_PREFIX}${cellName}`;
  const listed = workspaceListSchema.parse(
    JSON.parse(await herdrOk(processPort, ['workspace', 'list'], cwd)),
  );
  const existing = listed.result.workspaces.find(
    (workspace) => workspace.label === label,
  );
  if (existing !== undefined) return existing.workspace_id;
  const created = await herdrOk(
    processPort,
    ['workspace', 'create', '--label', label, '--cwd', cwd, '--no-focus'],
    cwd,
  );
  const workspaceId = WORKSPACE_ID.exec(created)?.[1];
  if (workspaceId === undefined) {
    throw new Error('herdr workspace create returned no workspace_id');
  }
  return workspaceId;
};

// The workspace's first tab follows the Cell log, as the legacy `logs` tab did. Cosmetic: failures are ignored.
const ensureLogsTab = async (
  processPort: ProcessPort,
  workspaceId: string,
  options: HerdrRunnerOptions,
): Promise<void> => {
  try {
    const { tabs } = tabListSchema.parse(
      JSON.parse(
        await herdrOk(
          processPort,
          ['tab', 'list', '--workspace', workspaceId],
          options.home,
        ),
      ),
    ).result;
    if (tabs.some((tab) => tab.label === LOGS_LABEL)) return;
    const [first] = [...tabs].sort((a, b) => a.number - b.number);
    if (first === undefined) return;
    const { panes } = paneListSchema.parse(
      JSON.parse(
        await herdrOk(
          processPort,
          ['pane', 'list', '--workspace', workspaceId],
          options.home,
        ),
      ),
    ).result;
    const pane = panes.find((item) => item.tab_id === first.tab_id);
    if (pane === undefined) return;
    // The Cell creates its log lazily; create it here so tail -F does not warn about a missing file.
    mkdirSync(dirname(options.logPath), { recursive: true });
    appendFileSync(options.logPath, '');
    await herdrOk(
      processPort,
      ['tab', 'rename', first.tab_id, LOGS_LABEL],
      options.home,
    );
    await herdrOk(
      processPort,
      [
        'pane',
        'run',
        pane.pane_id,
        `mkdir -p ${shellQuote(dirname(options.logPath))} && touch ${shellQuote(options.logPath)} && ${CLEAR_SCREEN} && exec tail -n ${LOG_TAIL_LINES} -F ${shellQuote(options.logPath)}`,
      ],
      options.home,
    );
  } catch {
    // the logs tab is for watching only
  }
};

export const createHerdrRunner = (
  processPort: ProcessPort,
  cellName: () => Promise<string>,
  options?: HerdrRunnerOptions,
): RunnerPort => {
  const runs = new Map<string, HerdrRun>();
  let started = 0;
  let previous: { runId: string; tabId: string } | undefined;
  let workspace: Promise<string> | undefined;
  const cellWorkspace = (cwd: string): Promise<string> => {
    workspace ??= cellName()
      .then(async (name) => {
        const id = await cellWorkspaceOf(
          processPort,
          name,
          options?.home ?? cwd,
        );
        if (options !== undefined) {
          await ensureLogsTab(processPort, id, options);
        }
        return id;
      })
      .catch((error: unknown) => {
        workspace = undefined;
        throw error;
      });
    return workspace;
  };
  return {
    // Herdr may be down at connect time; the first interactive run retries.
    prepare: async () => {
      await cellWorkspace(options?.home ?? process.cwd()).catch(
        () => undefined,
      );
    },
    start: async (spec: RunSpec): Promise<RunHandle> => {
      started += 1;
      const id = `herdr-${started}`;
      const stepDir = dirname(spec.logPath);
      mkdirSync(stepDir, { recursive: true });
      const exitFile = join(stepDir, `${id}.exit`);
      const pidFile = join(stepDir, `${id}.pid`);
      const launcher = join(stepDir, `${id}.sh`);
      writeFileSync(launcher, launcherOf(spec, exitFile, pidFile));
      chmodSync(launcher, 0o755);
      if (basename(spec.command) === CLAUDE) {
        acceptClaudeTrust(claudeConfigPathOf(), spec.cwd);
      }
      if (basename(spec.command) === ANTIGRAVITY) {
        acceptAntigravityTrust(antigravitySettingsPathOf(), spec.cwd);
      }
      if (previous !== undefined) {
        // A TUI step never writes its exit file; closing its tab ends its wait.
        const prior = runs.get(previous.runId);
        if (prior !== undefined) prior.aborted = true;
        await processPort.run(
          HERDR,
          ['tab', 'close', previous.tabId],
          spec.cwd,
        );
      }
      const workspaceId = await cellWorkspace(spec.cwd);
      const created = await herdrOk(
        processPort,
        [
          'tab',
          'create',
          '--workspace',
          workspaceId,
          '--cwd',
          spec.cwd,
          '--label',
          basename(stepDir),
          '--no-focus',
        ],
        spec.cwd,
      );
      const tabId = TAB_ID.exec(created)?.[1];
      const paneId = PANE_ID.exec(created)?.[1];
      if (tabId === undefined || paneId === undefined) {
        throw new Error('herdr tab create returned no tab_id or pane_id');
      }
      await herdrOk(
        processPort,
        ['pane', 'run', paneId, `bash ${shellQuote(launcher)}`],
        spec.cwd,
      );
      runs.set(id, {
        cwd: spec.cwd,
        tabId,
        exitFile,
        pidFile,
        aborted: false,
      });
      previous = { runId: id, tabId };
      return { id, pane: { workspaceId, tabId, paneId } };
    },
    abort: async (handle) => {
      const run = runs.get(handle.id);
      if (run === undefined) return true;
      run.aborted = true;
      const gone = await stopTree(processPort, run);
      await processPort.run(HERDR, ['tab', 'close', run.tabId], run.cwd);
      return gone;
    },
    interactiveAvailable: async () =>
      (await processPort.run(HERDR, ['status', 'server'], process.cwd()))
        .exitCode === 0,
    wait: async (handle): Promise<RunOutcome> => {
      const run = runs.get(handle.id);
      if (run === undefined) throw new Error(`unknown run ${handle.id}`);
      for (;;) {
        if (existsSync(run.exitFile)) {
          const code = Number.parseInt(readFileSync(run.exitFile, 'utf8'), 10);
          runs.delete(handle.id);
          return { exitCode: Number.isNaN(code) ? -1 : code };
        }
        if (run.aborted) {
          runs.delete(handle.id);
          return { exitCode: ABORTED_EXIT };
        }
        await sleep(POLL_MS);
      }
    },
  };
};
