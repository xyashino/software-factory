import { Refused } from '../application/core/errors';
import type { ClockPort } from '../application/ports/clock.port';
import { HEARTBEAT_INTERVAL_MS } from '../config';
import { joinPath } from '../domain/common/path';
import { worktreeRelOf } from '../domain/git/worktree-path';
import type { CellRecord } from './supervisor';

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 30_000;
const CRASH_WINDOW_MS = 60_000;
const CRASH_EXITS = 5;
const IDLE_ORDER = 0;
const READ_ONLY_ORDER = 1;
const WRITING_ORDER = 2;

export type CellState = 'idle' | 'running';

export interface Activity {
  state: CellState;
  orderId?: string;
  stationId?: string;
  writes?: boolean;
  since: number;
}

export interface CellSpec {
  projectId: string;
  repoRoot: string;
  lines?: string[];
}

export interface ScaleInput extends CellSpec {
  count: number;
}

export interface CellStatus {
  cellId: string;
  name: string;
  pid: number;
  state: CellState;
}

export interface ProjectStatus {
  projectId: string;
  repoRoot: string;
  desired: number;
  running: number;
  crashLoop: boolean;
  cells: CellStatus[];
}

export interface ScaleDeps {
  alive: (cellId: string) => boolean;
  clock: ClockPort;
  gate: () => string | null;
  spawn: (spec: CellSpec) => Promise<CellRecord>;
  stop: (cellId: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  lose: (cellId: string, worktree: string) => Promise<void>;
}

export interface Scale {
  set(input: ScaleInput): Promise<void>;
  list(): ProjectStatus[];
  report(cellId: string, activity: Activity): boolean;
  tick(): Promise<void>;
  stopAll(): Promise<void>;
}

interface Project extends CellSpec {
  desired: number;
  exits: number[];
  nextSpawnAt: number;
  crashLoop: boolean;
}

interface Owned {
  projectId: string;
  record: CellRecord;
}

const backoffOf = (exits: number): number =>
  Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (exits - 1));

// Scale-down order: idle first, then read-only, then writing; newest first within a group.
const orderOf = (activity: Activity | undefined): number => {
  if (activity === undefined || activity.state === 'idle') {
    return IDLE_ORDER;
  }
  return activity.writes === false ? READ_ONLY_ORDER : WRITING_ORDER;
};

export const createScale = (deps: ScaleDeps): Scale => {
  const projects = new Map<string, Project>();
  const owned = new Map<string, Owned>();
  const activity = new Map<string, Activity>();
  const stopping = new Set<string>();
  // The order whose worktree a Cell was seen with; a worktree missing before its first sighting is not a loss.
  const confirmed = new Map<string, string>();
  let lastCheckAt: number | null = null;

  const cellsOf = (projectId: string): string[] =>
    [...owned]
      .filter(([, cell]) => cell.projectId === projectId)
      .map(([cellId]) => cellId);

  const recordExit = (projectId: string): void => {
    const project = projects.get(projectId);
    if (project === undefined) {
      return;
    }
    const now = deps.clock.now();
    project.exits = [
      ...project.exits.filter((at) => now - at < CRASH_WINDOW_MS),
      now,
    ];
    if (project.exits.length >= CRASH_EXITS) {
      project.crashLoop = true;
      return;
    }
    project.nextSpawnAt = now + backoffOf(project.exits.length);
  };

  const reap = (): void => {
    for (const [cellId, cell] of [...owned]) {
      if (stopping.has(cellId) || deps.alive(cellId)) {
        continue;
      }
      owned.delete(cellId);
      activity.delete(cellId);
      confirmed.delete(cellId);
      recordExit(cell.projectId);
    }
  };

  const spawnOne = async (
    projectId: string,
    project: Project,
  ): Promise<void> => {
    const record = await deps.spawn({
      projectId,
      repoRoot: project.repoRoot,
      lines: project.lines,
    });
    owned.set(record.cellId, { projectId, record });
  };

  const retire = async (
    cellId: string,
    end: () => Promise<void>,
  ): Promise<void> => {
    stopping.add(cellId);
    try {
      await end();
      owned.delete(cellId);
      activity.delete(cellId);
      confirmed.delete(cellId);
    } finally {
      stopping.delete(cellId);
    }
  };

  const stopOne = (cellId: string): Promise<void> =>
    retire(cellId, () => deps.stop(cellId));

  const checkWorktrees = async (): Promise<void> => {
    for (const [cellId, cell] of [...owned]) {
      const current = activity.get(cellId);
      if (
        stopping.has(cellId) ||
        current?.state !== 'running' ||
        current.orderId === undefined
      ) {
        continue;
      }
      const worktree = worktreeRelOf(current.orderId);
      if (await deps.exists(joinPath(cell.record.repoRoot, worktree))) {
        confirmed.set(cellId, current.orderId);
        continue;
      }
      if (confirmed.get(cellId) !== current.orderId) {
        continue;
      }
      try {
        await retire(cellId, () => deps.lose(cellId, worktree));
      } catch {
        // The Cell stays owned when its kill fails; the next check retries it.
      }
    }
  };

  const set = async (input: ScaleInput): Promise<void> => {
    reap();
    const current = projects.get(input.projectId);
    const running = cellsOf(input.projectId);
    if (
      current !== undefined &&
      current.repoRoot !== input.repoRoot &&
      (current.desired > 0 || running.length > 0)
    ) {
      throw new Refused(
        `project ${input.projectId} already runs from ${current.repoRoot}`,
      );
    }
    if (input.count > running.length) {
      const gate = deps.gate();
      if (gate !== null) {
        throw new Refused(gate);
      }
    }
    const project: Project = {
      projectId: input.projectId,
      repoRoot: input.repoRoot,
      lines: input.lines,
      desired: input.count,
      exits: [],
      nextSpawnAt: 0,
      crashLoop: false,
    };
    projects.set(input.projectId, project);
    const victims = [...running].sort(
      (a, b) =>
        orderOf(activity.get(a)) - orderOf(activity.get(b)) ||
        (activity.get(b)?.since ?? 0) - (activity.get(a)?.since ?? 0),
    );
    for (const cellId of victims.slice(
      0,
      Math.max(0, running.length - input.count),
    )) {
      await stopOne(cellId);
    }
    for (
      let missing = input.count - running.length;
      missing > 0;
      missing -= 1
    ) {
      await spawnOne(input.projectId, project);
    }
    if (input.count === 0 && cellsOf(input.projectId).length === 0) {
      projects.delete(input.projectId);
    }
  };

  const list = (): ProjectStatus[] => {
    reap();
    return [...projects].map(([projectId, project]) => {
      const cells = [...owned]
        .filter(([, cell]) => cell.projectId === projectId)
        .map(([cellId, cell]) => ({
          cellId,
          name: cell.record.name,
          pid: cell.record.pid,
          state: activity.get(cellId)?.state ?? 'idle',
        }));
      return {
        projectId,
        repoRoot: project.repoRoot,
        desired: project.desired,
        running: cells.length,
        crashLoop: project.crashLoop,
        cells,
      };
    });
  };

  const report = (cellId: string, next: Activity): boolean => {
    reap();
    if (!owned.has(cellId)) {
      return false;
    }
    activity.set(cellId, next);
    return true;
  };

  const tick = async (): Promise<void> => {
    reap();
    const now = deps.clock.now();
    if (lastCheckAt === null || now - lastCheckAt >= HEARTBEAT_INTERVAL_MS) {
      lastCheckAt = now;
      await checkWorktrees();
    }
    if (deps.gate() !== null) {
      return;
    }
    for (const [projectId, project] of [...projects]) {
      if (project.crashLoop || now < project.nextSpawnAt) {
        continue;
      }
      for (
        let missing = project.desired - cellsOf(projectId).length;
        missing > 0;
        missing -= 1
      ) {
        try {
          await spawnOne(projectId, project);
        } catch {
          recordExit(projectId);
          break;
        }
      }
    }
  };

  const stopAll = async (): Promise<void> => {
    projects.clear();
    await Promise.all([...owned.keys()].map((cellId) => stopOne(cellId)));
  };

  return { set, list, report, tick, stopAll };
};
