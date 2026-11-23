import { describe, expect, it } from 'vitest';
import { Refused, Unreachable } from '../../../src/application/core/errors';
import type { Ports, Procedure } from '../../../src/application/core/procedure';
import type { DetachedSpec } from '../../../src/application/ports/process.port';
import { startWeb } from '../../../src/application/procedures/web/start.procedure';
import { statusWeb } from '../../../src/application/procedures/web/status.procedure';
import { stopWeb } from '../../../src/application/procedures/web/stop.procedure';
import type { Access } from '../../../src/domain/access';
import { createFakePorts } from '../../support/fake-ports';

const SUPERVISOR: Access = { kind: 'supervisor' };
const WEB_PID = 77;
const SPAWNED_PID = 555;
const START_INPUT = {
  bin: 'node',
  webEntry: '/web/server/entry.mjs',
  webArgs: ['/web/server/entry.mjs'],
  dataDir: '/data',
  factoryUrl: 'http://127.0.0.1:7070',
  projectId: 'project-1',
  host: '127.0.0.1',
  port: 4321,
};
const STATUS_INPUT = { dataDir: '/data', host: '127.0.0.1', port: 4321 };

const runAs = <I, O>(
  procedure: Procedure<I, O>,
  input: unknown,
  ports: Ports,
): Promise<O> =>
  procedure.execute(input, {
    ...ports,
    token: SUPERVISOR,
    principal: SUPERVISOR,
  });

const webPidFileWith = (initial: number | null): Ports['webPidFile'] => {
  let pid = initial;
  return {
    read: async () => pid,
    write: async (_dataDir, next) => {
      pid = next;
    },
    remove: async () => {
      pid = null;
    },
  };
};

const instantClock = (): Ports['clock'] => {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
};

describe('web start', () => {
  it('refuses to start while web.pid names a live process', async () => {
    // Arrange
    const fake = createFakePorts();
    const ports: Ports = {
      ...fake.ports,
      webPidFile: webPidFileWith(WEB_PID),
      process: { ...fake.ports.process, isAlive: (pid) => pid === WEB_PID },
    };

    // Act
    const start = runAs(startWeb, START_INPUT, ports);

    // Assert
    await expect(start).rejects.toThrow(Refused);
    await expect(start).rejects.toThrow('web already running');
  });

  it('fails as unreachable without spawning when the factory server is down', async () => {
    // Arrange
    const fake = createFakePorts();
    const ports: Ports = {
      ...fake.ports,
      webPidFile: webPidFileWith(null),
      server: { ...fake.ports.server, probe: async () => false },
    };

    // Act
    const start = runAs(startWeb, START_INPUT, ports);

    // Assert
    await expect(start).rejects.toBeInstanceOf(Unreachable);
    await expect(start).rejects.toThrow('sf server start');
  });

  it('passes the factory URL, project and data dir to the web process', async () => {
    // Arrange
    const fake = createFakePorts();
    const spawns: DetachedSpec[] = [];
    const ports: Ports = {
      ...fake.ports,
      webPidFile: webPidFileWith(null),
      clock: instantClock(),
      process: {
        ...fake.ports.process,
        spawnDetached: async (spec) => {
          spawns.push(spec);
          return SPAWNED_PID;
        },
        probeUrl: async () => true,
      },
    };

    // Act
    const result = await runAs(startWeb, START_INPUT, ports);

    // Assert
    expect(result).toEqual({ pid: SPAWNED_PID, url: 'http://127.0.0.1:4321' });
    expect(spawns[0]?.env).toEqual({
      HQ_URL: 'http://127.0.0.1:7070',
      HQ_DATA_DIR: '/data',
      HQ_PROJECT_ID: 'project-1',
      HOST: '127.0.0.1',
      PORT: '4321',
    });
  });

  it('terminates the web process when it never answers', async () => {
    // Arrange
    const fake = createFakePorts();
    const terminated: number[] = [];
    const ports: Ports = {
      ...fake.ports,
      webPidFile: webPidFileWith(null),
      clock: instantClock(),
      process: {
        ...fake.ports.process,
        spawnDetached: async () => SPAWNED_PID,
        probeUrl: async () => false,
        terminate: (pid) => {
          terminated.push(pid);
        },
      },
    };

    // Act
    const start = runAs(startWeb, START_INPUT, ports);

    // Assert
    await expect(start).rejects.toBeInstanceOf(Unreachable);
    expect(terminated).toEqual([SPAWNED_PID]);
  });
});

describe('web stop', () => {
  it('reports not-running when no web.pid exists', async () => {
    // Arrange
    const fake = createFakePorts();
    const ports: Ports = { ...fake.ports, webPidFile: webPidFileWith(null) };

    // Act
    const result = await runAs(stopWeb, { dataDir: '/data' }, ports);

    // Assert
    expect(result).toEqual({ outcome: 'not-running' });
  });

  it('reports stopped once SIGTERM ends the web process', async () => {
    // Arrange
    const fake = createFakePorts();
    let alive = true;
    const ports: Ports = {
      ...fake.ports,
      webPidFile: webPidFileWith(WEB_PID),
      clock: instantClock(),
      process: {
        ...fake.ports.process,
        isAlive: () => alive,
        terminate: () => {
          alive = false;
        },
      },
    };

    // Act
    const result = await runAs(stopWeb, { dataDir: '/data' }, ports);

    // Assert
    expect(result).toEqual({ outcome: 'stopped' });
  });
});

describe('web status', () => {
  it('reports running with pid and url while the web process lives', async () => {
    // Arrange
    const fake = createFakePorts();
    const ports: Ports = {
      ...fake.ports,
      webPidFile: webPidFileWith(WEB_PID),
      process: { ...fake.ports.process, isAlive: (pid) => pid === WEB_PID },
    };

    // Act
    const result = await runAs(statusWeb, STATUS_INPUT, ports);

    // Assert
    expect(result).toEqual({
      running: true,
      pid: WEB_PID,
      url: 'http://127.0.0.1:4321',
    });
  });

  it('reports stopped when no web.pid exists', async () => {
    // Arrange
    const fake = createFakePorts();
    const ports: Ports = { ...fake.ports, webPidFile: webPidFileWith(null) };

    // Act
    const result = await runAs(statusWeb, STATUS_INPUT, ports);

    // Assert
    expect(result).toEqual({ running: false });
  });
});
