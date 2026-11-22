import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCellControl } from '../../src/daemon/cell-control';
import { createFactoryRoutes } from '../../src/daemon/routes';
import { hqGateOf, type HqLink } from '../../src/daemon/hq-link';
import type { Relay } from '../../src/daemon/relay';
import {
  createScale,
  type ProjectStatus,
  type Scale,
} from '../../src/daemon/scale';
import { createSupervisor } from '../../src/daemon/supervisor';
import type { HqState } from '../../src/domain/factory/hq-state';
import { EXIT } from '../../src/domain/exit-codes';
import { createFakePorts, type FakePorts } from '../support/fake-ports';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const PROJECT = 'software-factory';
const REPO_A = '/repos/alpha';
const REPO_B = '/repos/beta';
const LOG_DIR = '/logs';
const OK = 200;
const CONFLICT = 409;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const SECOND_MS = 1_000;
const RESPAWN_BACKOFF_MS = [1, 2, 4, 8].map((seconds) => seconds * SECOND_MS);
const CRASH_WINDOW_MS = 60 * SECOND_MS;
const CRASH_LOOP_EXITS = 5;

interface Daemon {
  fake: FakePorts;
  scale: Scale;
  setHq(state: HqState): void;
  request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }>;
}

interface ProjectsBody {
  projects: ProjectStatus[];
}

const relayStub: Relay = {
  issue: (cellId) => `token-${cellId}`,
  hqCellIdOf: () => null,
  handle: async () => new Response(null, { status: NOT_FOUND }),
};

const daemonOf = (): Daemon => {
  const fake = createFakePorts();
  let hqState: HqState = { kind: 'ok' };
  const hq: HqLink = {
    state: () => hqState,
    tick: async () => undefined,
    stopped: () => false,
  };
  const supervisor = createSupervisor(fake.ports, LOG_DIR);
  const cells = createCellControl({
    ports: fake.ports,
    supervisor,
    relay: relayStub,
  });
  const scale = createScale({
    alive: (cellId) => supervisor.has(cellId),
    clock: fake.ports.clock,
    gate: () => hqGateOf(hq.state()),
    spawn: cells.spawn,
    stop: cells.stop,
  });
  const handle = createFactoryRoutes({
    ports: fake.ports,
    supervisor,
    scale,
    hq,
    relay: relayStub,
    identity: null,
  });
  return {
    fake,
    scale,
    setHq: (state) => {
      hqState = state;
    },
    request: async (method, path, body) => {
      const response = await handle(
        new Request(`http://127.0.0.1${path}`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return {
        status: response.status,
        body: (await response.json()) as unknown,
      };
    },
  };
};

const scaleTo = (
  daemon: Daemon,
  repoRoot: string,
  count: number,
  projectId = PROJECT,
): Promise<{ status: number; body: unknown }> =>
  daemon.request('PUT', '/scale', { repoRoot, projectId, count });

const projectsOf = async (daemon: Daemon): Promise<ProjectStatus[]> =>
  ((await daemon.request('GET', '/scale')).body as ProjectsBody).projects;

const cellIdsOf = async (daemon: Daemon): Promise<string[]> =>
  (await projectsOf(daemon)).flatMap((project) =>
    project.cells.map((cell) => cell.cellId),
  );

const reportActivity = (
  daemon: Daemon,
  cellId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> =>
  daemon.request('POST', `/cells/${cellId}/activity`, body);

const crashOneCell = (daemon: Daemon): void => {
  const [pid] = [...daemon.fake.alivePids];
  if (pid !== undefined) {
    daemon.fake.alivePids.delete(pid);
  }
};

describe('cell scale on the factory daemon', () => {
  it('scale 2 then scale 0 leaves no process', async () => {
    // Arrange
    const daemon = daemonOf();
    await scaleTo(daemon, REPO_A, 2);

    // Act
    const response = await scaleTo(daemon, REPO_A, 0);

    // Assert
    expect(response.status).toBe(OK);
    expect(daemon.fake.terminated).toHaveLength(2);
    expect(daemon.fake.alivePids.size).toBe(0);
    expect(await projectsOf(daemon)).toEqual([]);
  });

  it('scale down stops an idle cell before a working one', async () => {
    // Arrange
    const daemon = daemonOf();
    await scaleTo(daemon, REPO_A, 2);
    const [, working] = await cellIdsOf(daemon);
    await reportActivity(daemon, working ?? '', {
      state: 'running',
      writes: true,
      since: 1,
    });

    // Act
    await scaleTo(daemon, REPO_A, 1);

    // Assert
    expect(await cellIdsOf(daemon)).toEqual([working]);
  });

  it('scale down stops read-only cells, then the newest writing cell', async () => {
    // Arrange
    const daemon = daemonOf();
    await scaleTo(daemon, REPO_A, 4);
    const [, readOnly, olderWriter, newestWriter] = await cellIdsOf(daemon);
    await reportActivity(daemon, readOnly ?? '', {
      state: 'running',
      writes: false,
      since: 5,
    });
    await reportActivity(daemon, olderWriter ?? '', {
      state: 'running',
      writes: true,
      since: 10,
    });
    await reportActivity(daemon, newestWriter ?? '', {
      state: 'running',
      writes: true,
      since: 20,
    });

    // Act
    await scaleTo(daemon, REPO_A, 3);
    const afterIdle = await cellIdsOf(daemon);
    await scaleTo(daemon, REPO_A, 2);
    const afterReadOnly = await cellIdsOf(daemon);
    await scaleTo(daemon, REPO_A, 1);
    const afterWriter = await cellIdsOf(daemon);

    // Assert
    expect(afterIdle).toEqual([readOnly, olderWriter, newestWriter]);
    expect(afterReadOnly).toEqual([olderWriter, newestWriter]);
    expect(afterWriter).toEqual([olderWriter]);
  });

  it('a second repo path for the same project is refused naming the first', async () => {
    // Arrange
    const daemon = daemonOf();
    await scaleTo(daemon, REPO_A, 1);

    // Act
    const response = await scaleTo(daemon, REPO_B, 1);

    // Assert
    expect(response.status).toBe(CONFLICT);
    expect(JSON.stringify(response.body)).toContain(REPO_A);
  });

  it('scale up is refused while the factory is not connected', async () => {
    // Arrange
    const daemon = daemonOf();
    daemon.setHq({ kind: 'not_connected' });

    // Act
    const response = await scaleTo(daemon, REPO_A, 1);

    // Assert
    expect(response.status).toBe(CONFLICT);
    expect(JSON.stringify(response.body)).toContain('factory not connected');
    expect(daemon.fake.spawned).toHaveLength(0);
  });

  it('a crashing cell is respawned with backoff and stops after five exits', async () => {
    // Arrange
    const daemon = daemonOf();
    await scaleTo(daemon, REPO_A, 1);

    // Act
    for (const backoffMs of RESPAWN_BACKOFF_MS) {
      crashOneCell(daemon);
      await daemon.scale.tick();
      await daemon.fake.ports.clock.sleep(backoffMs - 1);
      await daemon.scale.tick();
      expect(await cellIdsOf(daemon)).toHaveLength(0);
      await daemon.fake.ports.clock.sleep(1);
      await daemon.scale.tick();
      expect(await cellIdsOf(daemon)).toHaveLength(1);
    }
    crashOneCell(daemon);
    await daemon.scale.tick();
    await daemon.fake.ports.clock.sleep(CRASH_WINDOW_MS);
    await daemon.scale.tick();

    // Assert
    const [project] = await projectsOf(daemon);
    expect(project).toMatchObject({ crashLoop: true, running: 0, desired: 1 });
    expect(daemon.fake.spawned).toHaveLength(5);
  });

  it('a daemon restart starts from zero cells', async () => {
    // Arrange
    const before = daemonOf();
    await scaleTo(before, REPO_A, 2);

    // Act
    const restarted = daemonOf();

    // Assert
    expect(await projectsOf(restarted)).toEqual([]);
  });

  it('an activity report marks the cell running and refuses an unknown cell', async () => {
    // Arrange
    const daemon = daemonOf();
    await scaleTo(daemon, REPO_A, 1);
    const [cellId] = await cellIdsOf(daemon);

    // Act
    const reported = await reportActivity(daemon, cellId ?? '', {
      state: 'running',
      orderId: 'order-1',
      stationId: 'build',
      writes: true,
      since: 5,
    });
    const unknown = await reportActivity(daemon, 'nope', {
      state: 'idle',
      since: 6,
    });
    const invalid = await reportActivity(daemon, cellId ?? '', {
      state: 'sleeping',
      since: 7,
    });

    // Assert
    expect(reported.status).toBe(OK);
    expect(unknown.status).toBe(NOT_FOUND);
    expect(invalid.status).toBe(BAD_REQUEST);
    expect((await projectsOf(daemon))[0]?.cells[0]?.state).toBe('running');
  });
});

describe('removed cell commands', () => {
  it.each([
    [['cell', 'create', '--repo', '.']],
    [['cell', 'stop', 'some-id']],
    [['cell', 'rm', 'some-id']],
  ])('%j exits non-zero and names the scale command', (args) => {
    // Act
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
    });

    // Assert
    expect(result.status).toBe(EXIT.argument);
    expect(result.stderr).toContain('use "sf cell scale N"');
  });
});

describe('cell scale crash window', () => {
  it('exits spread over more than a minute do not trip the crash loop', async () => {
    // Arrange
    const daemon = daemonOf();
    await scaleTo(daemon, REPO_A, 1);

    // Act
    for (let exit = 0; exit < CRASH_LOOP_EXITS + 1; exit += 1) {
      crashOneCell(daemon);
      await daemon.scale.tick();
      await daemon.fake.ports.clock.sleep(CRASH_WINDOW_MS);
      await daemon.scale.tick();
    }

    // Assert
    const [project] = await projectsOf(daemon);
    expect(project).toMatchObject({ crashLoop: false, running: 1 });
  });
});
