import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Activity } from '@repo/factory-contracts/scale.contract';
import { cellNameOf } from './cell-name';
import { Refused } from './errors';
import type { ClockPort, ProcessPort } from './ports';

const STOP_WAIT_MS = 10_000;
const KILL_WAIT_MS = 5_000;
const POLL_MS = 100;
const CELL_ID_BYTES = 4;

export interface CellRecord extends Activity {
  cellId: string;
  name: string;
  projectId: string;
  repoRoot: string;
  pid: number;
  startedAt: number;
}

export interface ProjectReport {
  projectId: string;
  desired: number;
  running: number;
}

export interface CellStart {
  args: string[];
  env: Record<string, string>;
}

export interface SpawnInput {
  repoRoot: string;
  projectId: string;
  name: string | undefined;
  baseName: string;
  start: (name: string, cellId: string) => Promise<CellStart>;
}

export interface Supervisor {
  spawn(input: SpawnInput): Promise<CellRecord>;
  list(): CellRecord[];
  projects(): ProjectReport[];
  has(cellId: string): boolean;
  setActivity(cellId: string, activity: Activity): boolean;
  kill(cellId: string): Promise<boolean>;
  killAll(): Promise<void>;
}

interface Entry {
  cellId: string;
  name: string;
  projectId: string;
  repoRoot: string;
  pid: number | null;
  startedAt: number;
  activity: Activity;
}

type RunningEntry = Entry & { pid: number };

interface SupervisorPorts {
  clock: ClockPort;
  process: ProcessPort;
}

const newCellIdOf = (taken: ReadonlyMap<string, Entry>): string => {
  for (;;) {
    const cellId = `cell-${randomBytes(CELL_ID_BYTES).toString('hex')}`;
    if (!taken.has(cellId)) {
      return cellId;
    }
  }
};

const allocateName = (base: string, taken: readonly string[]): string => {
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
};

const exitedWithin = async (
  ports: SupervisorPorts,
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
  ports: SupervisorPorts,
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
  ports: SupervisorPorts,
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
    projectId,
    repoRoot,
    pid,
    startedAt,
    activity,
  }: RunningEntry): CellRecord => ({
    cellId,
    name,
    projectId,
    repoRoot,
    pid,
    startedAt,
    ...activity,
  });

  const countByProject = (rows: readonly Entry[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.projectId, (counts.get(row.projectId) ?? 0) + 1);
    }
    return counts;
  };

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
    const startedAt = ports.clock.now();
    const entry: Entry = {
      cellId: newCellIdOf(entries),
      name,
      projectId: input.projectId,
      repoRoot: input.repoRoot,
      pid: null,
      startedAt,
      activity: { state: 'idle', writes: false, since: startedAt },
    };
    entries.set(entry.cellId, entry);
    try {
      const start = await input.start(name, entry.cellId);
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
    projects: () => {
      const desired = countByProject(pruneDead());
      const running = countByProject(runningOf());
      return [...desired].map(([projectId, count]) => ({
        projectId,
        desired: count,
        running: running.get(projectId) ?? 0,
      }));
    },
    has: (cellId) => pruneDead().some((entry) => entry.cellId === cellId),
    setActivity: (cellId, activity) => {
      const entry = pruneDead().find((item) => item.cellId === cellId);
      if (entry === undefined) {
        return false;
      }
      entry.activity = activity;
      return true;
    },
    kill,
    killAll: async () => {
      await Promise.all([...entries.keys()].map((cellId) => kill(cellId)));
    },
  };
};
