import type { Ports, Procedure } from '../../src/application/core/procedure';
import type { DetachedSpec } from '../../src/application/ports/process.port';
import type { Access } from '../../src/domain/access';
import {
  EMPTY_CONNECTION_CONFIG,
  type ConnectionConfig,
} from '../../src/domain/connection/connection-config';
import type { LocalSlot } from '../../src/domain/cell/local-slot';

export const PROJECTS_ROUTE = '/api/v1/projects';

export const PROJECTS_REPLY = {
  code: 200,
  projects: [
    {
      projectId: 'software-factory',
      repoUrl: 'https://example.test/software-factory.git',
      defaultBaseBranch: 'main',
      maxRunning: 5,
      createdAt: 1,
      updatedAt: 1,
    },
  ],
};

export interface ServerCall {
  method: 'GET' | 'POST' | 'DELETE';
  route: string;
  query?: Record<string, string>;
  body?: unknown;
  token: string;
}

export interface FakeOptions {
  config?: string | null;
  secret?: string | null;
  connectionConfig?: ConnectionConfig;
  todos?: Record<string, string>;
  reply?: (call: ServerCall) => unknown;
  writeOutcome?: 'written' | 'refused';
  slots?: LocalSlot[];
  alivePids?: number[];
}

export interface FakePorts {
  ports: Ports;
  calls: ServerCall[];
  writes: { dir: string; filename: string; force: boolean }[];
  savedConnections: ConnectionConfig[];
  spawned: DetachedSpec[];
  terminated: number[];
  slots: LocalSlot[];
  alivePids: Set<number>;
}

const unused = (): never => {
  throw new Error('port not used by this test');
};

const noReply = (): never => {
  throw new Error('no reply configured');
};

export const createFakePorts = (options: FakeOptions = {}): FakePorts => {
  const config =
    options.config === undefined
      ? JSON.stringify({ project: 'software-factory' })
      : options.config;
  const secret = options.secret === undefined ? 'secret-value' : options.secret;
  const todos = options.todos ?? {};
  const reply = options.reply ?? noReply;
  const calls: ServerCall[] = [];
  const writes: FakePorts['writes'] = [];
  const savedConnections: ConnectionConfig[] = [];
  const spawned: DetachedSpec[] = [];
  const terminated: number[] = [];
  const alivePids = new Set<number>(options.alivePids ?? []);
  let slots: LocalSlot[] = options.slots ?? [];
  let nextPid = 5000;
  let connectionConfig = options.connectionConfig ?? EMPTY_CONNECTION_CONFIG;
  const record = (call: ServerCall): unknown => {
    calls.push(call);
    return reply(call);
  };
  const ports: Ports = {
    server: {
      call: async (route, body, token) =>
        record({ method: 'POST', route, body, token }),
      get: async (route, query, token) =>
        record({ method: 'GET', route, query, token }),
      remove: async (route, token) =>
        record({ method: 'DELETE', route, token }),
      stream: unused,
      probe: async () => true,
    },
    connection: {
      url: 'http://127.0.0.1:7070',
      urlSource: 'default',
      token: secret,
      tokenSource: secret === null ? null : 'env:FACTORY_TOKEN',
    },
    connections: {
      path: '/fake/config/sf/config.json',
      read: () => connectionConfig,
      write: (next) => {
        connectionConfig = next;
        savedConnections.push(next);
      },
    },
    fs: {
      readText: async () => {
        if (config === null) {
          throw new Error('ENOENT');
        }
        return config;
      },
      writeText: unused,
      appendText: unused,
      exists: async () => config !== null,
      writable: async () => true,
      list: unused,
      readStdin: unused,
    },
    todoFiles: {
      list: async () =>
        Object.entries(todos).map(([filename, text]) => ({ filename, text })),
      write: async (dir, filename, _text, force) => {
        writes.push({ dir, filename, force });
        return options.writeOutcome ?? 'written';
      },
    },
    tokens: {
      read: async () => (secret === null ? null : { kind: 'supervisor' }),
      secret: async () => secret,
      write: unused,
      clear: unused,
    },
    operator: { open: unused, close: unused },
    runner: {
      prepare: async () => undefined,
      start: unused,
      abort: unused,
      wait: unused,
    },
    runners: {
      names: () => [],
      isInstalled: async () => false,
      commandLine: () => undefined,
    },
    git: {
      currentBranch: unused,
      isClean: unused,
      worktreeAdd: unused,
      worktreeRemove: unused,
      excludeLocally: unused,
      commit: unused,
      push: unused,
      headSha: unused,
      status: unused,
      clone: unused,
      originUrl: unused,
    },
    pr: { publish: unused },
    process: {
      run: unused,
      spawnDetached: async (spec) => {
        spawned.push(spec);
        nextPid += 1;
        alivePids.add(nextPid);
        return nextPid;
      },
      isAlive: (pid) => alivePids.has(pid),
      terminate: (pid) => {
        terminated.push(pid);
        alivePids.delete(pid);
      },
      probeUrl: unused,
    },
    pidFile: { read: unused, write: unused, acquire: unused, remove: unused },
    webPidFile: {
      read: unused,
      write: unused,
      acquire: unused,
      remove: unused,
    },
    clock: { now: () => 1_000, sleep: async () => undefined },
    cellState: { read: async () => null, write: unused },
    cellServer: {
      health: unused,
      get: unused,
      post: unused,
      patch: unused,
      delete: unused,
    },
    cellServerPidFile: {
      read: unused,
      write: unused,
      acquire: unused,
      remove: unused,
    },
    localSlots: {
      read: async () => slots,
      write: async (next) => {
        slots = next;
      },
      remove: async (slotId) => {
        slots = slots.filter((slot) => slot.slotId !== slotId);
      },
      logPathOf: (slotId) => `/fake/cells/${slotId}.log`,
    },
  };
  return {
    ports,
    calls,
    writes,
    savedConnections,
    spawned,
    terminated,
    get slots() {
      return slots;
    },
    alivePids,
  };
};

export const runProcedure = <I, O>(
  procedure: Procedure<I, O>,
  input: unknown,
  fake: FakePorts,
): Promise<O> => {
  const token: Access = { kind: 'supervisor' };
  return procedure.execute(input, { ...fake.ports, token, principal: token });
};
