import type { Ports, Procedure } from '../../src/application/core/procedure';
import type { Access } from '../../src/domain/access';

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
  todos?: Record<string, string>;
  reply?: (call: ServerCall) => unknown;
  writeOutcome?: 'written' | 'refused';
}

export interface FakePorts {
  ports: Ports;
  calls: ServerCall[];
  writes: { dir: string; filename: string; force: boolean }[];
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
    },
    pr: { publish: unused },
    process: {
      run: unused,
      spawnDetached: unused,
      isAlive: unused,
      terminate: unused,
      probeUrl: unused,
    },
    pidFile: { read: unused, write: unused, acquire: unused, remove: unused },
    webPidFile: {
      read: unused,
      write: unused,
      acquire: unused,
      remove: unused,
    },
    clock: { now: unused, sleep: unused },
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
  };
  return { ports, calls, writes };
};

export const runProcedure = <I, O>(
  procedure: Procedure<I, O>,
  input: unknown,
  fake: FakePorts,
): Promise<O> => {
  const token: Access = { kind: 'supervisor' };
  return procedure.execute(input, { ...fake.ports, token, principal: token });
};
