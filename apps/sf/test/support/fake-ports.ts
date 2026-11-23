import type { Ports, Procedure } from '../../src/application/core/procedure';
import type { DetachedSpec } from '../../src/application/ports/process.port';
import type { Access } from '../../src/domain/access';
import {
  EMPTY_CONNECTION_CONFIG,
  type ConnectionConfig,
} from '../../src/domain/connection/connection-config';

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
  method: 'GET' | 'POST' | 'PUT';
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
  daemon?: (call: DaemonCall) => unknown;
  parentPid?: number;
  alivePids?: number[];
  listening?: 'always' | 'after-spawn';
  pidFile?: number | null;
  serverLog?: string;
}

export interface DaemonCall {
  method: 'GET' | 'POST' | 'DELETE';
  route: string;
  body?: unknown;
}

export interface FakePorts {
  ports: Ports;
  calls: ServerCall[];
  writes: { dir: string; filename: string; force: boolean }[];
  savedConnections: ConnectionConfig[];
  spawned: DetachedSpec[];
  terminated: number[];
  daemonCalls: DaemonCall[];
  alivePids: Set<number>;
  pidFile: number | null;
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
  const listening = options.listening ?? 'always';
  const children = new Set<number>();
  let pidFile: number | null = options.pidFile ?? null;
  const daemonCalls: DaemonCall[] = [];
  const daemonReply = options.daemon ?? noReply;
  const recordDaemon = (call: DaemonCall): unknown => {
    daemonCalls.push(call);
    return daemonReply(call);
  };
  let nextPid = 5000;
  let time = 1_000;
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
      probe: async () =>
        listening === 'always' ||
        [...children].some((pid) => alivePids.has(pid)),
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
      readText: async (path) => {
        if (path.endsWith('/server.log')) {
          return options.serverLog ?? '';
        }
        if (config === null) {
          throw new Error('ENOENT');
        }
        return config;
      },
      writeText: unused,
      appendText: unused,
      remove: unused,
      exists: async () => config !== null,
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
      deleteBranch: unused,
      excludeLocally: unused,
      commit: unused,
      push: unused,
      headSha: unused,
      status: unused,
      clone: unused,
      originUrl: unused,
      resetHard: unused,
      clean: unused,
      discardChanges: unused,
      hasCommit: unused,
    },
    pr: { publish: unused },
    process: {
      run: unused,
      spawnDetached: async (spec) => {
        spawned.push(spec);
        nextPid += 1;
        alivePids.add(nextPid);
        children.add(nextPid);
        return nextPid;
      },
      isAlive: (pid) => alivePids.has(pid),
      parentPid: () => options.parentPid ?? 1,
      terminate: (pid) => {
        terminated.push(pid);
        alivePids.delete(pid);
      },
      forceKill: (pid) => {
        alivePids.delete(pid);
      },
      probeUrl: unused,
    },
    pidFile: {
      read: async () => pidFile,
      write: async (_dir, pid) => {
        pidFile = pid;
      },
      acquire: unused,
      remove: async () => {
        pidFile = null;
      },
    },
    webPidFile: {
      read: unused,
      write: unused,
      acquire: unused,
      remove: unused,
    },
    clock: {
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
    },
    factoryDaemon: {
      get: async (route) => recordDaemon({ method: 'GET', route }),
      post: async (route, body) =>
        recordDaemon({ method: 'POST', route, body }),
      put: async (route, body) => recordDaemon({ method: 'PUT', route, body }),
    },
    factoryPidFile: {
      read: async () => pidFile,
      write: async (_dir, pid) => {
        pidFile = pid;
      },
      acquire: unused,
      remove: async () => {
        pidFile = null;
      },
    },
  };
  return {
    ports,
    calls,
    writes,
    savedConnections,
    spawned,
    terminated,
    daemonCalls,
    alivePids,
    get pidFile() {
      return pidFile;
    },
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
