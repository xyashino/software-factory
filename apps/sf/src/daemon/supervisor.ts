import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Refused } from '../application/core/errors';
import type { Ports } from '../application/core/procedure';
import { cellNameOf } from '../domain/cell/cell-name';

const STOP_WAIT_MS = 10_000;
const KILL_WAIT_MS = 5_000;
const POLL_MS = 100;

export interface CellRecord {
  cellId: string;
  name: string;
  repoRoot: string;
  pid: number;
}

export interface CellStart {
  args: string[];
  env: Record<string, string>;
}

export interface SpawnInput {
  repoRoot: string;
  name: string | undefined;
  baseName: string;
  start: (name: string) => Promise<CellStart>;
}

export interface Supervisor {
  spawn(input: SpawnInput): Promise<CellRecord>;
  list(): CellRecord[];
  kill(cellId: string): Promise<boolean>;
  killAll(): Promise<void>;
}

interface Entry {
  cellId: string;
  name: string;
  repoRoot: string;
  pid: number | null;
}

type RunningEntry = Entry & { pid: number };

const allocateName = (base: string, taken: readonly string[]): string => {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
};

const exitedWithin = async (
  ports: Pick<Ports, 'process' | 'clock'>,
  pid: number,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = ports.clock.now() + timeoutMs;
  while (ports.process.isAlive(pid)) {
    if (ports.clock.now() >= deadline) {
      return false;
    }
    await ports.clock.sleep(POLL_MS);
  }
  return true;
};

const stopProcess = async (
  ports: Pick<Ports, 'process' | 'clock'>,
  pid: number,
): Promise<void> => {
  ports.process.terminate(pid);
  if (await exitedWithin(ports, pid, STOP_WAIT_MS)) {
    return;
  }
  ports.process.forceKill(pid);
  if (!(await exitedWithin(ports, pid, KILL_WAIT_MS))) {
    throw new Refused(`cell process ${pid} did not exit after SIGKILL`);
  }
};

export const createSupervisor = (
  ports: Pick<Ports, 'process' | 'clock'>,
  logDir: string,
): Supervisor => {
  const entries = new Map<string, Entry>();

  const isLive = (entry: Entry): boolean =>
    entry.pid === null || ports.process.isAlive(entry.pid);

  const pruneDead = (): Entry[] => {
    for (const entry of [...entries.values()]) {
      if (!isLive(entry)) {
        entries.delete(entry.cellId);
      }
    }
    return [...entries.values()];
  };

  const runningOf = (): RunningEntry[] =>
    pruneDead().filter((entry): entry is RunningEntry => entry.pid !== null);

  const recordOf = ({
    cellId,
    name,
    repoRoot,
    pid,
  }: RunningEntry): CellRecord => ({
    cellId,
    name,
    repoRoot,
    pid,
  });

  const spawn = async (input: SpawnInput): Promise<CellRecord> => {
    const taken = pruneDead().map((entry) => entry.name);
    let name: string;
    if (input.name === undefined) {
      name = allocateName(cellNameOf(input.baseName), taken);
    } else {
      name = cellNameOf(input.name);
      if (taken.includes(name)) {
        throw new Refused(`cell ${name} already running`);
      }
    }
    const entry: Entry = {
      cellId: randomUUID(),
      name,
      repoRoot: input.repoRoot,
      pid: null,
    };
    entries.set(entry.cellId, entry);
    try {
      const start = await input.start(name);
      entry.pid = await ports.process.spawnDetached({
        command: process.execPath,
        args: start.args,
        env: start.env,
        cwd: input.repoRoot,
        logPath: join(logDir, `${entry.cellId}.log`),
      });
    } catch (error) {
      entries.delete(entry.cellId);
      throw error;
    }
    return recordOf({ ...entry, pid: entry.pid });
  };

  const kill = async (cellId: string): Promise<boolean> => {
    const entry = entries.get(cellId);
    if (entry === undefined || entry.pid === null) {
      return false;
    }
    await stopProcess(ports, entry.pid);
    entries.delete(cellId);
    return true;
  };

  return {
    spawn,
    list: () => runningOf().map(recordOf),
    kill,
    killAll: async () => {
      await Promise.all([...entries.keys()].map((cellId) => kill(cellId)));
    },
  };
};
