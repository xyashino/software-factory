import { describe, expect, it } from 'vitest';
import type { Access } from '../../../src/domain/access';
import type { Ports } from '../../../src/application/core/procedure';
import {
  type SetupResult,
  setup,
} from '../../../src/application/procedures/setup/setup.procedure';
import {
  EMPTY_CONNECTION_CONFIG,
  LOCAL_TARGET,
} from '../../../src/domain/connection/connection-config';
import type { LocalSlot } from '../../../src/domain/cell/local-slot';
import {
  LINE_STANDARD,
  repoConfigText,
} from '../../../src/domain/init/templates';
import {
  createFakePorts,
  type FakePorts,
  type ServerCall,
} from '../../support/fake-ports';

const SUPERVISOR: Access = { kind: 'supervisor' };
const ROOT = '/repo';
const CONFIG = '/repo/.factory/config.json';
const LINES = '/repo/.factory/lines';
const ORIGIN = 'https://example.test/widgets.git';
const SAVED_TOKEN = 'saved-token';
const MINTED_TOKEN = 'minted-token';
const JOIN_TOKEN = 'join-token';
const PROJECTS = '/api/v1/projects';
const SETUP_INPUT = {
  cwd: ROOT,
  dirName: 'repo',
  configPath: CONFIG,
  linesDir: LINES,
  dataDir: '/data',
  dbPath: '/data/factory.db',
  bin: '/usr/bin/sf',
  serverArgs: ['server.js'],
  port: 7070,
  launcher: [],
};
const READY_FILES = {
  [CONFIG]: repoConfigText('widgets'),
  [`${LINES}/standard.yml`]: LINE_STANDARD,
};
const SAVED_CONNECTIONS = {
  ...EMPTY_CONNECTION_CONFIG,
  current: LOCAL_TARGET,
  targets: {
    [LOCAL_TARGET]: { url: 'http://127.0.0.1:7070', token: SAVED_TOKEN },
  },
};
const LIVE_CELL: LocalSlot = {
  slotId: 'slot-x',
  name: 'x',
  factory: 'http://127.0.0.1:7070',
  repoRoot: ROOT,
  pid: 42,
  state: 'running',
  createdAt: 1,
};

interface MachineOptions {
  files?: Record<string, string>;
  origin?: string | null;
  missing?: string[];
  serverUp?: boolean;
  savedToken?: boolean;
  registered?: string[];
  slots?: LocalSlot[];
  alivePids?: number[];
}

interface Machine {
  ports: Ports;
  fake: FakePorts;
  files: Record<string, string>;
}

const projectOf = (projectId: string) => ({
  projectId,
  repoUrl: ORIGIN,
  defaultBaseBranch: 'main',
  maxRunning: 5,
  createdAt: 1,
  updatedAt: 1,
});

const replyFor = (
  call: ServerCall,
  registered: string[],
): Record<string, unknown> => {
  if (call.method === 'GET') {
    return {
      code: 200,
      projects: registered.map((projectId) => projectOf(projectId)),
    };
  }
  if (call.route === PROJECTS) {
    const { projectId } = call.body as { projectId: string };
    registered.push(projectId);
    return { code: 201, project: projectOf(projectId) };
  }
  return {
    code: 201,
    tokenId: 'token-1',
    kind: 'cell_join',
    token: JOIN_TOKEN,
    scopes: [],
    expiresAt: null,
  };
};

const machine = (options: MachineOptions = {}): Machine => {
  const files: Record<string, string> = { ...(options.files ?? {}) };
  const registered = [...(options.registered ?? [])];
  const state = { serverUp: options.serverUp ?? false };
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const missing = options.missing ?? [];
  const fake = createFakePorts({
    secret: null,
    connectionConfig: options.savedToken ? SAVED_CONNECTIONS : undefined,
    slots: options.slots,
    alivePids: options.alivePids,
    reply: (call) => replyFor(call, registered),
  });
  const ports: Ports = {
    ...fake.ports,
    server: { ...fake.ports.server, probe: async () => state.serverUp },
    git: { ...fake.ports.git, originUrl: async () => origin },
    fs: {
      ...fake.ports.fs,
      readText: async (path) => {
        if (!(path in files)) {
          throw new Error(`ENOENT ${path}`);
        }
        return files[path];
      },
      writeText: async (path, text) => {
        files[path] = text;
      },
      appendText: async (path, text) => {
        files[path] = `${files[path] ?? ''}${text}`;
      },
      exists: async (path) => path in files,
      list: async (dir) =>
        Object.keys(files)
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1)),
      writable: async () => true,
    },
    tokens: {
      ...fake.ports.tokens,
      secret: async () =>
        fake.ports.connections.read().targets[LOCAL_TARGET]?.token ?? null,
    },
    runners: { ...fake.ports.runners, isInstalled: async () => true },
    pidFile: {
      ...fake.ports.pidFile,
      read: async () => null,
      write: async () => {},
      remove: async () => {},
    },
    process: {
      ...fake.ports.process,
      run: async (command, args) => {
        if (command === 'git' && args[0] === 'remote') {
          return origin === null
            ? { exitCode: 2, stdout: '', stderr: '' }
            : { exitCode: 0, stdout: `${origin}\n`, stderr: '' };
        }
        if (missing.includes(command)) {
          return { exitCode: 127, stdout: '', stderr: '' };
        }
        if (args.includes('admin')) {
          return { exitCode: 0, stdout: `${MINTED_TOKEN}\n`, stderr: '' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      spawnDetached: async (spec) => {
        const pid = await fake.ports.process.spawnDetached(spec);
        if (!spec.args.includes('cell')) {
          state.serverUp = true;
        }
        return pid;
      },
    },
  };
  return { ports, fake, files };
};

const runSetup = (
  m: Machine,
  input: Record<string, unknown> = {},
): Promise<SetupResult> =>
  setup.execute(
    { ...SETUP_INPUT, ...input },
    { ...m.ports, token: SUPERVISOR, principal: SUPERVISOR },
  );

const stepNamed = (result: SetupResult, step: string) =>
  result.steps.find((candidate) => candidate.step === step);

const writesOf = (m: Machine): number =>
  m.fake.calls.filter((call) => call.method === 'POST').length;

describe('sf setup', () => {
  it('takes a fresh repo to server up and project registered in one run', async () => {
    // Arrange
    const m = machine();

    // Act
    const result = await runSetup(m);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => [step.step, step.status])).toEqual([
      ['doctor', 'skipped'],
      ['init', 'ran'],
      ['server', 'ran'],
      ['project', 'ran'],
      ['cell', 'skipped'],
    ]);
    expect(m.files[CONFIG]).toBe(repoConfigText('widgets'));
    expect(m.fake.spawned).toHaveLength(1);
    expect(m.fake.calls).toContainEqual(
      expect.objectContaining({ method: 'POST', route: PROJECTS }),
    );
  });

  it('changes nothing and runs no step when the repo is already set up', async () => {
    // Arrange
    const m = machine({
      files: READY_FILES,
      serverUp: true,
      savedToken: true,
      registered: ['widgets'],
    });

    // Act
    const result = await runSetup(m);

    // Assert
    expect(result.ok).toBe(true);
    expect(result.steps.every((step) => step.status === 'skipped')).toBe(true);
    expect(m.fake.spawned).toHaveLength(0);
    expect(writesOf(m)).toBe(0);
  });

  it('stops before any side effect when a required machine check is missing', async () => {
    // Arrange
    const m = machine({ missing: ['git'] });

    // Act
    const result = await runSetup(m);

    // Assert
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(stepNamed(result, 'doctor')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('git'),
    });
    expect(m.files).toEqual({});
    expect(m.fake.spawned).toHaveLength(0);
    expect(m.fake.calls).toHaveLength(0);
  });

  it('lets a down server through because setup starts it', async () => {
    // Arrange
    const m = machine({ files: READY_FILES, savedToken: false });

    // Act
    const result = await runSetup(m);

    // Assert
    expect(stepNamed(result, 'doctor')?.status).not.toBe('failed');
    expect(stepNamed(result, 'server')?.status).toBe('ran');
    expect(result.ok).toBe(true);
  });

  it('asks for a project add with the fix when origin is absent', async () => {
    // Arrange
    const m = machine({
      files: READY_FILES,
      origin: null,
      serverUp: true,
      savedToken: true,
    });

    // Act
    const result = await runSetup(m);

    // Assert
    expect(result.ok).toBe(false);
    expect(stepNamed(result, 'project')).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining(
        'sf project add widgets --repo <repo-url>',
      ),
    });
    expect(writesOf(m)).toBe(0);
  });

  it('starts a named cell when no live cell has that name', async () => {
    // Arrange
    const m = machine({
      files: READY_FILES,
      serverUp: true,
      savedToken: true,
      registered: ['widgets'],
    });

    // Act
    const result = await runSetup(m, { cell: 'x' });

    // Assert
    expect(stepNamed(result, 'cell')?.status).toBe('ran');
    expect(m.fake.spawned.at(-1)?.args).toEqual([
      'cell',
      'start',
      '--name',
      'x',
    ]);
  });

  it('skips the cell when a live cell already has that name', async () => {
    // Arrange
    const m = machine({
      files: READY_FILES,
      serverUp: true,
      savedToken: true,
      registered: ['widgets'],
      slots: [LIVE_CELL],
      alivePids: [42],
    });

    // Act
    const result = await runSetup(m, { cell: 'x' });

    // Assert
    expect(stepNamed(result, 'cell')?.status).toBe('skipped');
    expect(m.fake.spawned).toHaveLength(0);
  });

  it('never returns the token secrets in the result', async () => {
    // Arrange
    const m = machine();

    // Act
    const result = await runSetup(m, { cell: 'x' });

    // Assert
    const text = JSON.stringify(result);
    expect(text).not.toContain(MINTED_TOKEN);
    expect(text).not.toContain(JOIN_TOKEN);
    expect(text).not.toContain(SAVED_TOKEN);
  });
});
