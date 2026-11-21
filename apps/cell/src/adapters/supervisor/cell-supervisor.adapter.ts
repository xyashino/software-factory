import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  SlotLaunch,
  SupervisorPort,
} from '../../application/ports/supervisor.port';
import type { RuntimeStatus } from '../../domain/cells/cell-slot';
import type { SlotId } from '../../domain/common/brand';
import { nextBackoffMs } from '../../domain/cells/slot-allocation';

const DRAIN_TIMEOUT_MS = 10_000;

export type SlotStatusReport = {
  runtimeStatus: RuntimeStatus;
  pid: number | null;
  lastError?: string;
};

export type CellSupervisor = SupervisorPort & { shutdown(): Promise<void> };

export type CellSupervisorOptions = {
  command: readonly [string, ...string[]];
  restartBackoffMs: () => number;
  onStatus: (slotId: SlotId, report: SlotStatusReport) => void;
};

type Entry = {
  launch: SlotLaunch;
  child: ChildProcess | null;
  wanted: boolean;
  attempt: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
};

const exitedOf = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => child.once('exit', () => resolve()));

const exitWithin = async (
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const exited = exitedOf(child).then(() => true);
  const outcome = await Promise.race([exited, timedOut]);
  clearTimeout(timer);
  return outcome;
};

const environmentOf = (launch: SlotLaunch): NodeJS.ProcessEnv => ({
  ...process.env,
  FACTORY_URL: launch.factoryUrl,
  CELL_NAME: launch.name,
  CELL_SESSION_TOKEN: launch.sessionToken,
  CELL_LOG_PATH: launch.logPath,
  HERDR_ENABLED: String(launch.herdrEnabled),
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createCellSupervisor = (
  options: CellSupervisorOptions,
): CellSupervisor => {
  const entries = new Map<SlotId, Entry>();

  const spawnChild = (entry: Entry): ChildProcess => {
    mkdirSync(dirname(entry.launch.logPath), { recursive: true });
    const log = openSync(entry.launch.logPath, 'a');
    try {
      const [bin, ...args] = options.command;
      return spawn(bin, args, {
        cwd: entry.launch.repoRoot,
        env: environmentOf(entry.launch),
        stdio: ['ignore', log, log],
      });
    } finally {
      closeSync(log);
    }
  };

  const launch = (slotId: SlotId, entry: Entry): number | null => {
    const child = spawnChild(entry);
    entry.child = child;
    const gone = (reason: string) => {
      if (entry.child !== child) return;
      entry.child = null;
      if (entry.wanted) scheduleRestart(slotId, entry, reason);
    };
    child.on('error', (error) => gone(messageOf(error)));
    child.on('exit', (code, signal) =>
      gone(`worker exited with ${signal ?? `code ${code}`}`),
    );
    return child.pid ?? null;
  };

  const scheduleRestart = (slotId: SlotId, entry: Entry, reason: string) => {
    options.onStatus(slotId, {
      runtimeStatus: 'failed',
      pid: null,
      lastError: reason,
    });
    const delay = nextBackoffMs(entry.attempt, options.restartBackoffMs());
    entry.attempt += 1;
    entry.restartTimer = setTimeout(() => {
      entry.restartTimer = null;
      if (!entry.wanted) return;
      try {
        const pid = launch(slotId, entry);
        options.onStatus(slotId, { runtimeStatus: 'running', pid });
      } catch (error) {
        scheduleRestart(slotId, entry, messageOf(error));
      }
    }, delay);
  };

  const entryOf = (slotId: SlotId, launchSpec: SlotLaunch): Entry => {
    const existing = entries.get(slotId);
    if (existing !== undefined) return existing;
    const created: Entry = {
      launch: launchSpec,
      child: null,
      wanted: false,
      attempt: 0,
      restartTimer: null,
    };
    entries.set(slotId, created);
    return created;
  };

  const stop = async (
    slotId: SlotId,
    stopOptions: { force: boolean },
  ): Promise<void> => {
    const entry = entries.get(slotId);
    if (entry === undefined) return;
    entry.wanted = false;
    if (entry.restartTimer !== null) clearTimeout(entry.restartTimer);
    entry.restartTimer = null;
    const child = entry.child;
    if (child === null) return;
    if (!stopOptions.force) {
      child.kill('SIGTERM');
      if (await exitWithin(child, DRAIN_TIMEOUT_MS)) return;
    }
    child.kill('SIGKILL');
    await exitedOf(child);
  };

  return {
    start: async (slotLaunch) => {
      const entry = entryOf(slotLaunch.slotId, slotLaunch);
      entry.launch = slotLaunch;
      entry.wanted = true;
      entry.attempt = 0;
      if (entry.child !== null) return { pid: entry.child.pid ?? null };
      return { pid: launch(slotLaunch.slotId, entry) };
    },
    stop,
    status: async (slotId) =>
      entries.get(slotId)?.child ? 'running' : 'stopped',
    shutdown: async () => {
      await Promise.all(
        [...entries.keys()].map((slotId) => stop(slotId, { force: false })),
      );
    },
  };
};
