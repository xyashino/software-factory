import { describe, expect, it } from 'vitest';
import type { Ports } from '../../../src/application/core/procedure';
import { createSupervisor } from '../../../src/factory/supervisor';

const LOG_DIR = '/data/sf/cells';
const BASE_NAME = 'dev-box';
const SHORT_EXIT_MS = 0;
const SLOW_EXIT_MS = 500;
const SIGTERM_IGNORED_MS = 10_000;

interface Host {
  ports: Pick<Ports, 'process' | 'clock'>;
  isRunning: (pid: number) => boolean;
  crash: (pid: number) => void;
  now: () => number;
  pids: () => number[];
}

const unused = (): never => {
  throw new Error('port not used by this test');
};

const hostOf = (options: {
  exitAfterMs: number;
  ignoresTerm?: boolean;
}): Host => {
  let time = 0;
  let nextPid = 100;
  const exitAt = new Map<number, number | null>();
  const isRunning = (pid: number): boolean => {
    if (!exitAt.has(pid)) {
      return false;
    }
    const at = exitAt.get(pid);
    return at === null || at === undefined || time < at;
  };
  const ports: Pick<Ports, 'process' | 'clock'> = {
    process: {
      run: unused,
      probeUrl: unused,
      spawnDetached: async () => {
        nextPid += 1;
        exitAt.set(nextPid, null);
        return nextPid;
      },
      isAlive: isRunning,
      parentPid: () => 1,
      terminate: (pid) => {
        if (options.ignoresTerm !== true && exitAt.get(pid) === null) {
          exitAt.set(pid, time + options.exitAfterMs);
        }
      },
      forceKill: (pid) => {
        exitAt.delete(pid);
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
    isRunning,
    crash: (pid) => {
      exitAt.delete(pid);
    },
    now: () => time,
    pids: () => [...exitAt.keys()].filter(isRunning),
  };
};

const startOf = async () => ({ args: ['cell', 'start'], env: {} });

const spawnCell = (
  supervisor: ReturnType<typeof createSupervisor>,
  name?: string,
) =>
  supervisor.spawn({
    repoRoot: '/repo',
    name,
    baseName: BASE_NAME,
    start: startOf,
  });

describe('factory daemon supervisor', () => {
  it('kill resolves only after the Cell exits', async () => {
    // Arrange
    const host = hostOf({ exitAfterMs: SLOW_EXIT_MS });
    const supervisor = createSupervisor(host.ports, LOG_DIR);
    const cell = await spawnCell(supervisor);

    // Act
    const killed = await supervisor.kill(cell.cellId);

    // Assert
    expect(killed).toBe(true);
    expect(host.isRunning(cell.pid)).toBe(false);
    expect(host.now()).toBeGreaterThanOrEqual(SLOW_EXIT_MS);
  });

  it('kill escalates to SIGKILL when SIGTERM is ignored', async () => {
    // Arrange
    const host = hostOf({ exitAfterMs: SHORT_EXIT_MS, ignoresTerm: true });
    const supervisor = createSupervisor(host.ports, LOG_DIR);
    const cell = await spawnCell(supervisor);

    // Act
    await supervisor.kill(cell.cellId);

    // Assert
    expect(host.isRunning(cell.pid)).toBe(false);
    expect(host.now()).toBeGreaterThanOrEqual(SIGTERM_IGNORED_MS);
  });

  it('kill of an unknown Cell reports it was not found', async () => {
    // Arrange
    const host = hostOf({ exitAfterMs: SHORT_EXIT_MS });
    const supervisor = createSupervisor(host.ports, LOG_DIR);

    // Act
    const killed = await supervisor.kill('no-such-cell');

    // Assert
    expect(killed).toBe(false);
  });

  it('stop all kills every Cell', async () => {
    // Arrange
    const host = hostOf({ exitAfterMs: SLOW_EXIT_MS });
    const supervisor = createSupervisor(host.ports, LOG_DIR);
    await spawnCell(supervisor);
    await spawnCell(supervisor);

    // Act
    await supervisor.killAll();

    // Assert
    expect(supervisor.list()).toEqual([]);
    expect(host.pids()).toEqual([]);
  });

  it('dead Cell drops from list', async () => {
    // Arrange
    const host = hostOf({ exitAfterMs: SHORT_EXIT_MS });
    const supervisor = createSupervisor(host.ports, LOG_DIR);
    const cell = await spawnCell(supervisor);

    // Act
    host.crash(cell.pid);

    // Assert
    expect(supervisor.list()).toEqual([]);
  });

  it('Cell names stay unique while running', async () => {
    // Arrange
    const host = hostOf({ exitAfterMs: SHORT_EXIT_MS });
    const supervisor = createSupervisor(host.ports, LOG_DIR);
    const first = await spawnCell(supervisor);
    const second = await spawnCell(supervisor);

    // Act
    const duplicate = spawnCell(supervisor, first.name);

    // Assert
    expect([first.name, second.name]).toEqual([BASE_NAME, `${BASE_NAME}-2`]);
    await expect(duplicate).rejects.toThrow(
      `cell ${BASE_NAME} already running`,
    );
  });

  it('a stopped Cell frees its name', async () => {
    // Arrange
    const host = hostOf({ exitAfterMs: SHORT_EXIT_MS });
    const supervisor = createSupervisor(host.ports, LOG_DIR);
    const first = await spawnCell(supervisor);
    await supervisor.kill(first.cellId);

    // Act
    const again = await spawnCell(supervisor);

    // Assert
    expect(again.name).toBe(BASE_NAME);
  });
});
