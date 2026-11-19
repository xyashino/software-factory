import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ProcessPort } from '../../application/ports/process.port';
import type {
  RunHandle,
  RunnerPort,
  RunOutcome,
  RunSpec,
} from '../../application/ports/runner.port';
import { acceptClaudeTrust, claudeConfigPathOf } from './claude-trust';

const HERDR = 'herdr';
const CLAUDE = 'claude';
const POLL_MS = 1000;
const ABORTED_EXIT = 130;
const WORKSPACE_ENV = 'FACTORY_HERDR_WORKSPACE';
const TAB_ID = /"tab_id"\s*:\s*"([^"]+)"/;
const PANE_ID = /"pane_id"\s*:\s*"([^"]+)"/;

interface HerdrRun {
  cwd: string;
  tabId: string;
  exitFile: string;
  aborted: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

const launcherOf = (spec: RunSpec, exitFile: string): string =>
  [
    '#!/bin/bash',
    `cd ${shellQuote(spec.cwd)} || exit 127`,
    ...Object.entries(spec.env).map(
      ([key, value]) => `export ${key}=${shellQuote(value)}`,
    ),
    [spec.command, ...spec.args].map(shellQuote).join(' ') +
      `; echo "$?" > ${shellQuote(exitFile)}`,
    '',
  ].join('\n');

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

const workspaceArgsOf = async (
  processPort: ProcessPort,
  cwd: string,
): Promise<string[]> => {
  const label = process.env[WORKSPACE_ENV];
  if (label === undefined) return [];
  const listed = await herdrOk(processPort, ['workspace', 'list'], cwd);
  const match = new RegExp(
    `"label"\\s*:\\s*"${label}"[^}]*"workspace_id"\\s*:\\s*"([^"]+)"`,
  ).exec(listed);
  return match?.[1] === undefined ? [] : ['--workspace', match[1]];
};

export const createHerdrRunner = (processPort: ProcessPort): RunnerPort => {
  const runs = new Map<string, HerdrRun>();
  let started = 0;
  let previousTabId: string | undefined;
  return {
    start: async (spec: RunSpec): Promise<RunHandle> => {
      started += 1;
      const id = `herdr-${started}`;
      const stepDir = dirname(spec.logPath);
      mkdirSync(stepDir, { recursive: true });
      const exitFile = join(stepDir, `${id}.exit`);
      const launcher = join(stepDir, `${id}.sh`);
      writeFileSync(launcher, launcherOf(spec, exitFile));
      chmodSync(launcher, 0o755);
      if (basename(spec.command) === CLAUDE) {
        acceptClaudeTrust(claudeConfigPathOf(), spec.cwd);
      }
      if (previousTabId !== undefined) {
        await processPort.run(HERDR, ['tab', 'close', previousTabId], spec.cwd);
      }
      const created = await herdrOk(
        processPort,
        [
          'tab',
          'create',
          ...(await workspaceArgsOf(processPort, spec.cwd)),
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
      runs.set(id, { cwd: spec.cwd, tabId, exitFile, aborted: false });
      previousTabId = tabId;
      return { id };
    },
    abort: async (handle) => {
      const run = runs.get(handle.id);
      if (run === undefined) return;
      run.aborted = true;
      await processPort.run(HERDR, ['tab', 'close', run.tabId], run.cwd);
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
