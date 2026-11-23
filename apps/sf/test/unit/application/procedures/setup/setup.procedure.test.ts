import { describe, expect, it } from 'vitest';
import { Refused } from '../../../../../src/application/core/errors';
import type { Ports } from '../../../../../src/application/core/procedure';
import {
  runSetup,
  type SetupStep,
} from '../../../../../src/application/procedures/setup/setup.procedure';
import type { Access } from '../../../../../src/domain/access';
import { createFakePorts } from '../../../../support/fake-ports';

const REPO = '/repo';
const CONFIG_PATH = `${REPO}/.factory/config.json`;
const LINES_DIR = `${REPO}/.factory/lines`;
const DATA_DIR = '/data/sf';
const DB_PATH = '/data/sf/factory.db';
const ORIGIN = 'https://example.test/software-factory.git';
const PROJECT = 'software-factory';
const MINTED = 'minted-supervisor-token';
const SERVER_ARG = '/src/server.ts';
const SUPERVISOR: Access = { kind: 'supervisor' };

interface Machine {
  files: Map<string, string>;
  serverUp: boolean;
  secret: string | null;
  projects: string[];
  cells: {
    cellId: string;
    name: string;
    projectId: string;
    repoRoot: string;
    pid: number;
  }[];
  gitMissing: boolean;
  actions: string[];
}

interface Arrangement {
  machine: Machine;
  ports: Ports;
}

const projectDto = (projectId: string) => ({
  projectId,
  repoUrl: ORIGIN,
  defaultBaseBranch: 'main',
  maxRunning: 5,
  createdAt: 1,
  updatedAt: 1,
});

const arrange = (overrides: Partial<Machine> = {}): Arrangement => {
  const machine: Machine = {
    files: new Map(),
    serverUp: false,
    secret: null,
    projects: [],
    cells: [],
    gitMissing: false,
    actions: [],
    ...overrides,
  };
  const fake = createFakePorts();
  const ports: Ports = {
    ...fake.ports,
    server: {
      ...fake.ports.server,
      probe: async () => machine.serverUp,
      get: async () => ({
        code: 200,
        projects: machine.projects.map(projectDto),
      }),
      call: async (route, body) => {
        if (route === '/api/v1/tokens') {
          const { name } = body as { name: string };
          return {
            code: 201,
            tokenId: 'tok-1',
            kind: 'factory_join',
            token: `join-${name}`,
            scopes: [],
            expiresAt: null,
          };
        }
        const { projectId } = body as { projectId: string };
        machine.projects.push(projectId);
        machine.actions.push(`project-add:${projectId}`);
        return { code: 201, project: projectDto(projectId) };
      },
    },
    fs: {
      ...fake.ports.fs,
      readText: async (path) => {
        const text = machine.files.get(path);
        if (text === undefined) {
          throw new Error('ENOENT');
        }
        return text;
      },
      writeText: async (path, text) => {
        machine.files.set(path, text);
        machine.actions.push(`write:${path}`);
      },
      appendText: async (path, text) => {
        machine.files.set(path, `${machine.files.get(path) ?? ''}${text}`);
      },
      exists: async (path) =>
        machine.files.has(path) || path.startsWith('/data'),
      list: async () => [],
    },
    git: {
      ...fake.ports.git,
      originUrl: async () => ORIGIN,
    },
    process: {
      ...fake.ports.process,
      run: async (command, args) => {
        if (command === 'git' && machine.gitMissing) {
          return { exitCode: 127, stdout: '', stderr: '' };
        }
        if (command === 'git' && args[0] === 'remote') {
          return { exitCode: 0, stdout: `${ORIGIN}\n`, stderr: '' };
        }
        if (args.includes('create')) {
          machine.secret = MINTED;
          return { exitCode: 0, stdout: `${MINTED}\n`, stderr: '' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      spawnDetached: async (spec) => {
        const pid = await fake.ports.process.spawnDetached(spec);
        machine.actions.push('spawn:server');
        machine.serverUp = true;
        return pid;
      },
    },
    pidFile: {
      ...fake.ports.pidFile,
      read: async () => null,
      write: async () => undefined,
      remove: async () => undefined,
    },
    tokens: {
      ...fake.ports.tokens,
      read: async () => (machine.secret === null ? null : SUPERVISOR),
      secret: async () => machine.secret,
    },
    factoryDaemon: {
      get: async () => ({ cells: machine.cells }),
      post: async (_route, body) => {
        const { name } = body as { name: string };
        const cell = {
          cellId: `cell-${name}`,
          name,
          projectId: 'proj-1',
          repoRoot: REPO,
          pid: machine.cells.length + 1,
        };
        machine.cells.push(cell);
        machine.actions.push('spawn:cell');
        return cell;
      },
      delete: async () => {
        throw new Refused('not used by setup');
      },
    },
  };
  return { machine, ports };
};

const runSetupOn = (
  ports: Ports,
  overrides: { cell?: string; project?: string } = {},
): Promise<{ steps: SetupStep[] }> =>
  runSetup.execute(
    {
      repoRoot: REPO,
      dirName: 'repo',
      repoConfigPath: CONFIG_PATH,
      linesDir: LINES_DIR,
      dataDir: DATA_DIR,
      dbPath: DB_PATH,
      port: 7070,
      bin: '/usr/bin/bun',
      serverArgs: [SERVER_ARG],
      reconnect: () => ports,
      ...overrides,
    },
    { ...ports, token: SUPERVISOR, principal: SUPERVISOR },
  );

const configuredMachine = (): Partial<Machine> => ({
  files: new Map([[CONFIG_PATH, JSON.stringify({ project: PROJECT })]]),
});

describe('sf setup', () => {
  it('fresh repo reaches server up and project registered', async () => {
    // Arrange
    const { machine, ports } = arrange();

    // Act
    const result = await runSetupOn(ports);

    // Assert
    expect(result.steps).toEqual([
      { step: 'doctor', outcome: 'done' },
      { step: 'init', outcome: 'done' },
      { step: 'server', outcome: 'done' },
      { step: 'project', outcome: 'done' },
    ]);
    expect(machine.serverUp).toBe(true);
    expect(machine.projects).toEqual([PROJECT]);
    expect(machine.files.has(CONFIG_PATH)).toBe(true);
  });

  it('second run changes nothing and exits ok', async () => {
    // Arrange
    const { machine, ports } = arrange();
    await runSetupOn(ports);
    machine.actions.length = 0;

    // Act
    const result = await runSetupOn(ports);

    // Assert
    expect(result.steps).toEqual([
      { step: 'doctor', outcome: 'done' },
      { step: 'init', outcome: 'skipped' },
      { step: 'server', outcome: 'skipped' },
      { step: 'project', outcome: 'skipped' },
    ]);
    expect(machine.actions).toEqual([]);
    expect(machine.projects).toEqual([PROJECT]);
  });

  it('doctor failure stops before any side effect', async () => {
    // Arrange
    const { machine, ports } = arrange({ gitMissing: true });

    // Act
    const run = runSetupOn(ports);

    // Assert
    await expect(run).rejects.toThrow(Refused);
    expect(machine.actions).toEqual([]);
    expect(machine.files.size).toBe(0);
    expect(machine.serverUp).toBe(false);
  });

  it('doctor missing server does not block setup', async () => {
    // Arrange
    const { ports } = arrange(configuredMachine());

    // Act
    const result = await runSetupOn(ports);

    // Assert
    expect(result.steps).toContainEqual({ step: 'server', outcome: 'done' });
    expect(result.steps).toContainEqual({ step: 'project', outcome: 'done' });
  });

  it('no cell started without --cell', async () => {
    // Arrange
    const { machine, ports } = arrange();

    // Act
    const result = await runSetupOn(ports);

    // Assert
    expect(machine.actions).not.toContain('spawn:cell');
    expect(result.steps.map((step) => step.step)).not.toContain('cell');
  });

  it('--cell starts one local cell and skips when already live', async () => {
    // Arrange
    const { machine, ports } = arrange();
    await runSetupOn(ports, { cell: 'dev-box' });
    const spawnedFirst = machine.actions.filter((action) =>
      action.startsWith('spawn:cell'),
    );

    // Act
    const result = await runSetupOn(ports, { cell: 'dev-box' });

    // Assert
    expect(spawnedFirst).toEqual(['spawn:cell']);
    expect(
      machine.actions.filter((action) => action.startsWith('spawn:cell')),
    ).toEqual(['spawn:cell']);
    expect(result.steps).toContainEqual({ step: 'cell', outcome: 'skipped' });
  });

  it('output never contains the token', async () => {
    // Arrange
    const { ports } = arrange();

    // Act
    const result = await runSetupOn(ports);

    // Assert
    expect(JSON.stringify(result)).not.toContain(MINTED);
  });
});
