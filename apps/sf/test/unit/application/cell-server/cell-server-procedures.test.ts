import { describe, expect, it } from 'vitest';
import {
  ArgumentError,
  Refused,
  Unreachable,
} from '../../../../src/application/core/errors';
import type { Ports } from '../../../../src/application/core/procedure';
import type { CellServerPort } from '../../../../src/application/ports/cell-server.port';
import type { DetachedSpec } from '../../../../src/application/ports/process.port';
import { startCellServer } from '../../../../src/application/procedures/cell-server/start.procedure';
import { statusCellServer } from '../../../../src/application/procedures/cell-server/status.procedure';
import { stopCellServer } from '../../../../src/application/procedures/cell-server/stop.procedure';
import {
  addFactory,
  listFactories,
} from '../../../../src/application/procedures/cell-server/factories.procedure';
import {
  getSettings,
  setSettings,
} from '../../../../src/application/procedures/cell-server/settings.procedure';
import { createFakePorts } from '../../../support/fake-ports';

const DATA_DIR = '/data/sf';
const SUPERVISOR = { kind: 'supervisor' } as const;
const SETTINGS = {
  herdr_enabled: false,
  default_runner: 'claude',
  restart_backoff_ms: 1000,
  max_local_cells: 4,
  git_fetch_on_worktree: true,
};

const unusedCellServer: CellServerPort = {
  health: async () => {
    throw new Unreachable('down');
  },
  get: async () => {
    throw new Unreachable('down');
  },
  post: async () => {
    throw new Unreachable('down');
  },
  patch: async () => {
    throw new Unreachable('down');
  },
  delete: async () => {
    throw new Unreachable('down');
  },
};

const clockAt = (start: number): Ports['clock'] => {
  let now = start;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
};

const idlePidFile: Ports['cellServerPidFile'] = {
  read: async () => null,
  write: async () => undefined,
  acquire: async () => true,
  remove: async () => undefined,
};

const withPorts = (overrides: Partial<Ports>): Ports => {
  const fake = createFakePorts().ports;
  return {
    ...fake,
    clock: clockAt(0),
    cellServerPidFile: idlePidFile,
    process: {
      ...fake.process,
      isAlive: () => false,
      terminate: () => undefined,
    },
    ...overrides,
  };
};

const runAs = <I, O>(
  procedure: { execute: (raw: unknown, ctx: never) => Promise<O> },
  input: I,
  ports: Ports,
): Promise<O> =>
  procedure.execute(input, {
    ...ports,
    token: SUPERVISOR,
    principal: SUPERVISOR,
  } as never);

const startInput = {
  bin: '/usr/bin/bun',
  serverArgs: ['/repo/apps/cell/src/index.ts'],
  dataDir: DATA_DIR,
  xdgDataHome: '/data',
  host: '127.0.0.1',
  port: 7071,
};

describe('cell server start', () => {
  it('refuses when a cell server already answers', async () => {
    // Arrange
    const ports = withPorts({
      cellServer: { ...unusedCellServer, health: async () => ({ code: 200 }) },
    });

    // Act
    const attempt = runAs(startCellServer, startInput, ports);

    // Assert
    await expect(attempt).rejects.toThrow(Refused);
  });

  it('spawns the server on the given host and port and returns its pid', async () => {
    // Arrange
    const spawned: DetachedSpec[] = [];
    const written: number[] = [];
    let answering = false;
    const ports = withPorts({
      cellServer: {
        ...unusedCellServer,
        health: async () => {
          if (!answering) throw new Unreachable('down');
          return { code: 200 };
        },
      },
      process: {
        ...createFakePorts().ports.process,
        isAlive: () => false,
        terminate: () => undefined,
        spawnDetached: async (spec) => {
          spawned.push(spec);
          answering = true;
          return 4242;
        },
      },
      cellServerPidFile: {
        ...idlePidFile,
        write: async (_dir, pid) => {
          written.push(pid);
        },
      },
    });

    // Act
    const result = await runAs(startCellServer, startInput, ports);

    // Assert
    expect(result).toEqual({ pid: 4242 });
    expect(written).toEqual([4242]);
    expect(spawned[0]?.env).toEqual({
      CELL_SERVER_HOST: '127.0.0.1',
      CELL_SERVER_PORT: '7071',
      XDG_DATA_HOME: '/data',
    });
    expect(spawned[0]?.logPath).toBe(`${DATA_DIR}/cell-server.log`);
  });

  it('stops the spawned server and reports Unreachable when it never answers', async () => {
    // Arrange
    const terminated: number[] = [];
    const ports = withPorts({
      cellServer: unusedCellServer,
      process: {
        ...createFakePorts().ports.process,
        isAlive: () => false,
        spawnDetached: async () => 7,
        terminate: (pid) => terminated.push(pid),
      },
    });

    // Act
    const attempt = runAs(startCellServer, startInput, ports);

    // Assert
    await expect(attempt).rejects.toThrow(Unreachable);
    expect(terminated).toEqual([7]);
  });
});

describe('cell server stop', () => {
  it('reports not_running when no pid file exists', async () => {
    // Arrange
    const ports = withPorts({});

    // Act
    const result = await runAs(stopCellServer, { dataDir: DATA_DIR }, ports);

    // Assert
    expect(result).toEqual({ outcome: 'not_running' });
  });
});

describe('cell server status', () => {
  it('reports not healthy and no settings while the server is down', async () => {
    // Arrange
    const ports = withPorts({
      cellServer: unusedCellServer,
      cellServerPidFile: { ...idlePidFile, read: async () => 99 },
    });

    // Act
    const result = await runAs(statusCellServer, { dataDir: DATA_DIR }, ports);

    // Assert
    expect(result).toEqual({
      pid: 99,
      alive: false,
      healthy: false,
      settings: null,
    });
  });

  it('includes the settings when the server answers', async () => {
    // Arrange
    const ports = withPorts({
      cellServer: {
        ...unusedCellServer,
        health: async () => ({ code: 200 }),
        get: async () => ({ code: 200, settings: SETTINGS }),
      },
    });

    // Act
    const result = await runAs(statusCellServer, { dataDir: DATA_DIR }, ports);

    // Assert
    expect(result.healthy).toBe(true);
    expect(result.settings).toEqual(SETTINGS);
  });
});

describe('cell server settings', () => {
  it('refuses a key outside the known settings', async () => {
    // Arrange
    const ports = withPorts({ cellServer: unusedCellServer });

    // Act
    const attempt = runAs(
      setSettings,
      { key: 'unknown_key', value: '1' },
      ports,
    );

    // Assert
    await expect(attempt).rejects.toThrow(ArgumentError);
  });

  it('patches a boolean value parsed from its text', async () => {
    // Arrange
    const patches: unknown[] = [];
    const ports = withPorts({
      cellServer: {
        ...unusedCellServer,
        patch: async (route, body) => {
          patches.push({ route, body });
          return { code: 200, settings: { ...SETTINGS, herdr_enabled: true } };
        },
      },
    });

    // Act
    const result = await runAs(
      setSettings,
      { key: 'herdr_enabled', value: 'true' },
      ports,
    );

    // Assert
    expect(patches).toEqual([
      { route: '/api/v1/settings', body: { herdr_enabled: true } },
    ]);
    expect(result.herdr_enabled).toBe(true);
  });
});

describe('factory add', () => {
  it('sends only the tokens and default flag that were given', async () => {
    // Arrange
    const posted: unknown[] = [];
    const ports = withPorts({
      cellServer: {
        ...unusedCellServer,
        post: async (route, body) => {
          posted.push({ route, body });
          return {
            code: 200,
            factory: {
              factoryId: 'f-1',
              name: 'home',
              url: 'http://10.0.0.5:7070',
              isDefault: false,
              hasJoinToken: true,
              hasSupervisorToken: false,
              createdAt: 1,
              updatedAt: 1,
            },
          };
        },
      },
    });

    // Act
    await runAs(
      addFactory,
      {
        name: 'home',
        url: 'http://10.0.0.5:7070',
        joinToken: 'jt-1',
        isDefault: false,
      },
      ports,
    );

    // Assert
    expect(posted).toEqual([
      {
        route: '/api/v1/factories',
        body: { name: 'home', url: 'http://10.0.0.5:7070', joinToken: 'jt-1' },
      },
    ]);
  });
});

describe('cell server reply drift', () => {
  it('reports a readable error naming the drifted settings field', async () => {
    // Arrange
    const ports = withPorts({
      cellServer: {
        ...unusedCellServer,
        get: async () => ({
          code: 200,
          settings: { ...SETTINGS, default_runner: 'gemini' },
        }),
      },
    });

    // Act
    const attempt = runAs(getSettings, {}, ports);

    // Assert
    await expect(attempt).rejects.toThrow(Unreachable);
    await expect(attempt).rejects.toThrow(
      /\/api\/v1\/settings does not match its contract: settings\.default_runner/,
    );
  });

  it('reports a readable error when a factory row lacks a field the contract requires', async () => {
    // Arrange
    const ports = withPorts({
      cellServer: {
        ...unusedCellServer,
        get: async () => ({
          code: 200,
          factories: [
            {
              factoryId: 'f-1',
              name: 'home',
              url: 'http://10.0.0.5:7070',
              isDefault: false,
              hasJoinToken: true,
              hasSupervisorToken: false,
            },
          ],
        }),
      },
    });

    // Act
    const attempt = runAs(listFactories, {}, ports);

    // Assert
    await expect(attempt).rejects.toThrow(Unreachable);
    await expect(attempt).rejects.toThrow(/createdAt/);
  });

  it('keeps a valid settings reply unchanged', async () => {
    // Arrange
    const ports = withPorts({
      cellServer: {
        ...unusedCellServer,
        get: async () => ({ code: 200, settings: SETTINGS }),
      },
    });

    // Act
    const result = await runAs(getSettings, {}, ports);

    // Assert
    expect(result).toEqual(SETTINGS);
  });
});
