import { describe, expect, it } from 'vitest';
import type { Ports } from '../../../src/application/core/procedure';
import { Refused } from '../../../src/application/core/errors';
import { createScaler } from '../../../src/factory/scaler';
import { createSupervisor } from '../../../src/factory/supervisor';

const REPO = '/repos/alpha';
const OTHER_REPO = '/repos/beta';
const PROJECT = 'alpha';
const BASE_NAME = 'dev-box';
const RESPAWN_MS = 1_000;
const EXIT_DETECT_MS = 100;

const unused = (): never => {
  throw new Error('port not used by this test');
};

interface Host {
  ports: Pick<Ports, 'process' | 'clock'>;
  crash: (pid: number) => void;
  advance: (ms: number) => void;
}

const hostOf = (): Host => {
  let time = 0;
  let nextPid = 100;
  const exited = new Set<number>();
  const alive = new Set<number>();
  const ports: Pick<Ports, 'process' | 'clock'> = {
    process: {
      run: unused,
      probeUrl: unused,
      spawnDetached: async () => {
        nextPid += 1;
        alive.add(nextPid);
        return nextPid;
      },
      isAlive: (pid) => alive.has(pid) && !exited.has(pid),
      parentPid: () => 1,
      terminate: (pid) => {
        alive.delete(pid);
      },
      forceKill: (pid) => {
        alive.delete(pid);
      },
    },
    clock: {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    },
  };
  return {
    ports,
    crash: (pid) => {
      exited.add(pid);
      alive.delete(pid);
    },
    advance: (ms) => {
      time += ms;
    },
  };
};

const sceneOf = (options: { gate?: string | null } = {}) => {
  const host = hostOf();
  const supervisor = createSupervisor(host.ports, '/data/sf/cells');
  const stopped: string[] = [];
  const scaler = createScaler({
    supervisor,
    now: () => host.ports.clock.now(),
    baseName: BASE_NAME,
    start: async ({ name }) => ({
      args: ['cell', 'start', '--name', name],
      env: {},
    }),
    gate: () => options.gate ?? null,
    onStopped: async (cell) => {
      stopped.push(cell.cellId);
    },
  });
  return { host, supervisor, scaler, stopped };
};

const cellsOf = (scene: ReturnType<typeof sceneOf>) =>
  scene.scaler.status().flatMap((project) => project.cells);

describe('cell scaling', () => {
  it('starts as many cells as the desired count', async () => {
    // Arrange
    const scene = sceneOf();

    // Act
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 2,
      lines: undefined,
    });

    // Assert
    expect(scene.scaler.status()).toEqual([
      expect.objectContaining({ projectId: PROJECT, desired: 2, running: 2 }),
    ]);
  });

  it('stops idle cells before cells that run read-only work', async () => {
    // Arrange
    const scene = sceneOf();
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 3,
      lines: undefined,
    });
    const [idle, reader, writer] = cellsOf(scene);
    scene.supervisor.setActivity(reader!.cellId, {
      state: 'running',
      writes: false,
      since: 0,
    });
    scene.supervisor.setActivity(writer!.cellId, {
      state: 'running',
      writes: true,
      since: 0,
    });

    // Act
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 2,
      lines: undefined,
    });

    // Assert
    expect(scene.stopped).toEqual([idle!.cellId]);
  });

  it('stops the newest writing cell when all cells write', async () => {
    // Arrange
    const scene = sceneOf();
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 1,
      lines: undefined,
    });
    scene.host.advance(1);
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 2,
      lines: undefined,
    });
    const [older, newer] = cellsOf(scene);
    for (const cell of [older!, newer!]) {
      scene.supervisor.setActivity(cell.cellId, {
        state: 'running',
        writes: true,
        since: 0,
      });
    }

    // Act
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 1,
      lines: undefined,
    });

    // Assert
    expect(scene.stopped).toEqual([newer!.cellId]);
  });

  it('respawns a cell that exits on its own', async () => {
    // Arrange
    const scene = sceneOf();
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 1,
      lines: undefined,
    });
    const [first] = cellsOf(scene);
    scene.host.crash(first!.pid);

    // Act
    scene.host.advance(EXIT_DETECT_MS);
    await scene.scaler.reconcile();
    scene.host.advance(RESPAWN_MS);
    await scene.scaler.reconcile();

    // Assert
    const [respawned] = cellsOf(scene);
    expect(respawned).toEqual(
      expect.objectContaining({ projectId: PROJECT, state: 'idle' }),
    );
    expect(respawned!.cellId).not.toBe(first!.cellId);
  });

  it('marks a crash loop after five exits in a minute and stops respawning', async () => {
    // Arrange
    const scene = sceneOf();
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 1,
      lines: undefined,
    });

    // Act
    for (let exit = 0; exit < 5; exit += 1) {
      const [cell] = cellsOf(scene);
      scene.host.crash(cell!.pid);
      scene.host.advance(EXIT_DETECT_MS);
      await scene.scaler.reconcile();
      scene.host.advance(RESPAWN_MS * 2 ** exit);
      await scene.scaler.reconcile();
    }

    // Assert
    expect(scene.scaler.status()).toEqual([
      expect.objectContaining({ crashLoop: true, running: 0 }),
    ]);
  });

  it('refuses a scale up while the factory is not connected', async () => {
    // Arrange
    const scene = sceneOf({ gate: 'factory not connected' });

    // Act
    const scale = scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 1,
      lines: undefined,
    });

    // Assert
    await expect(scale).rejects.toBeInstanceOf(Refused);
    expect(cellsOf(scene)).toEqual([]);
  });

  it('refuses a second repo path for a project that already runs cells', async () => {
    // Arrange
    const scene = sceneOf();
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 1,
      lines: undefined,
    });

    // Act
    const scale = scene.scaler.set({
      repoRoot: OTHER_REPO,
      projectId: PROJECT,
      count: 1,
      lines: undefined,
    });

    // Assert
    await expect(scale).rejects.toThrow(`already scales from ${REPO}`);
  });

  it('stops every cell and forgets the desired counts on stop all', async () => {
    // Arrange
    const scene = sceneOf();
    await scene.scaler.set({
      repoRoot: REPO,
      projectId: PROJECT,
      count: 2,
      lines: undefined,
    });

    // Act
    await scene.scaler.stopAll();

    // Assert
    expect(scene.scaler.status()).toEqual([]);
    expect(scene.stopped).toHaveLength(2);
  });
});
