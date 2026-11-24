import { Refused } from '../application/core/errors';
import type { CellRecord, CellStart, Supervisor } from './supervisor';

const RESPAWN_BASE_MS = 1_000;
const RESPAWN_MAX_MS = 30_000;
const CRASH_WINDOW_MS = 60_000;
const CRASH_EXITS = 5;

export interface ScaleRequest {
  repoRoot: string;
  projectId: string;
  count: number;
  lines: readonly string[] | undefined;
}

export interface ProjectScale {
  projectId: string;
  repoRoot: string;
  desired: number;
  running: number;
  crashLoop: boolean;
  cells: CellRecord[];
}

export interface StartCellInput {
  cellId: string;
  name: string;
  projectId: string;
  repoRoot: string;
  lines: readonly string[] | undefined;
}

export interface ScalerDeps {
  supervisor: Supervisor;
  now: () => number;
  baseName: string;
  start: (input: StartCellInput) => Promise<CellStart>;
  gate: () => string | null;
  onStopped: (cell: CellRecord) => Promise<void>;
}

export interface Scaler {
  set(request: ScaleRequest): Promise<void>;
  reconcile(): Promise<void>;
  status(): ProjectScale[];
  stopAll(): Promise<void>;
}

interface Scale {
  repoRoot: string;
  desired: number;
  lines: readonly string[] | undefined;
  exits: number[];
  crashLoop: boolean;
  nextSpawnAt: number;
}

const backoffOf = (exitsInWindow: number): number =>
  Math.min(RESPAWN_BASE_MS * 2 ** (exitsInWindow - 1), RESPAWN_MAX_MS);

const rankOf = (cell: CellRecord): number => {
  if (cell.state === 'idle') {
    return 0;
  }
  return cell.writes ? 2 : 1;
};

const killOrder = (a: CellRecord, b: CellRecord): number =>
  rankOf(a) - rankOf(b) || b.startedAt - a.startedAt;

export const createScaler = (deps: ScalerDeps): Scaler => {
  const scales = new Map<string, Scale>();
  const owned = new Map<string, string>();

  const cellsOf = (projectId: string): CellRecord[] =>
    deps.supervisor.list().filter((cell) => cell.projectId === projectId);

  const recordExit = (scale: Scale, now: number): void => {
    scale.exits = [
      ...scale.exits.filter((at) => now - at < CRASH_WINDOW_MS),
      now,
    ];
    if (scale.exits.length >= CRASH_EXITS) {
      scale.crashLoop = true;
      return;
    }
    scale.nextSpawnAt = now + backoffOf(scale.exits.length);
  };

  const spawnOne = async (
    projectId: string,
    scale: Scale,
  ): Promise<boolean> => {
    try {
      const cell = await deps.supervisor.spawn({
        repoRoot: scale.repoRoot,
        projectId,
        name: undefined,
        baseName: deps.baseName,
        start: (name, cellId) =>
          deps.start({
            cellId,
            name,
            projectId,
            repoRoot: scale.repoRoot,
            lines: scale.lines,
          }),
      });
      owned.set(cell.cellId, projectId);
      return true;
    } catch {
      // A failed spawn counts as an exit, so backoff and crash loop apply.
      recordExit(scale, deps.now());
      return false;
    }
  };

  const spawnMissing = async (
    projectId: string,
    scale: Scale,
  ): Promise<void> => {
    while (
      !scale.crashLoop &&
      deps.now() >= scale.nextSpawnAt &&
      cellsOf(projectId).length < scale.desired
    ) {
      if (!(await spawnOne(projectId, scale))) {
        return;
      }
    }
  };

  const detectExits = (now: number): void => {
    for (const [cellId, projectId] of [...owned]) {
      if (deps.supervisor.has(cellId)) {
        continue;
      }
      owned.delete(cellId);
      const scale = scales.get(projectId);
      if (scale !== undefined) {
        recordExit(scale, now);
      }
    }
  };

  const stopExcess = async (projectId: string, keep: number): Promise<void> => {
    const ordered = cellsOf(projectId).sort(killOrder);
    for (const cell of ordered.slice(0, Math.max(0, ordered.length - keep))) {
      owned.delete(cell.cellId);
      await deps.supervisor.kill(cell.cellId);
      await deps.onStopped(cell);
    }
  };

  const reconcile = async (): Promise<void> => {
    detectExits(deps.now());
    for (const [projectId, scale] of scales) {
      await spawnMissing(projectId, scale);
    }
  };

  return {
    set: async (request) => {
      const existing = scales.get(request.projectId);
      const held = cellsOf(request.projectId);
      if (
        existing !== undefined &&
        existing.repoRoot !== request.repoRoot &&
        (existing.desired > 0 || held.length > 0)
      ) {
        throw new Refused(
          `project ${request.projectId} already scales from ${existing.repoRoot}`,
        );
      }
      if (request.count > held.length) {
        const gate = deps.gate();
        if (gate !== null) {
          throw new Refused(gate);
        }
      }
      scales.set(request.projectId, {
        repoRoot: request.repoRoot,
        desired: request.count,
        lines: request.lines,
        exits: [],
        crashLoop: false,
        nextSpawnAt: 0,
      });
      await stopExcess(request.projectId, request.count);
      await reconcile();
    },
    reconcile,
    status: () =>
      [...scales].map(([projectId, scale]) => {
        const cells = cellsOf(projectId);
        return {
          projectId,
          repoRoot: scale.repoRoot,
          desired: scale.desired,
          running: cells.length,
          crashLoop: scale.crashLoop,
          cells,
        };
      }),
    stopAll: async () => {
      for (const [projectId, scale] of scales) {
        scale.desired = 0;
        await stopExcess(projectId, 0);
      }
      scales.clear();
    },
  };
};
