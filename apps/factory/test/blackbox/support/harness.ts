import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FactoryCredential } from '@repo/factory-contracts/status.contract';
import { createFactoryApp, type FactoryApp } from '../../../src/app';
import { createHqLinkClient } from '../../../src/adapters/hq-link-client';
import { createRepoConfigAdapter } from '../../../src/adapters/repo-config';
import { createLocalEngine, type LocalEngine } from '../../../src/local-engine';
import type {
  DetachedSpec,
  FactoryPorts,
  HqLinkPort,
} from '../../../src/ports';

export const PROJECT_ID = 'alpha';
export const FACTORY_ORIGIN = 'http://factory.test';

interface HarnessOptions {
  credential?: FactoryCredential | null;
  hqLink?: HqLinkPort;
}

export interface Harness {
  app: FactoryApp;
  local: LocalEngine;
  spawned: DetachedSpec[];
  repoRoot: string;
}

const repoRootOf = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'factory-repo-'));
  mkdirSync(join(root, '.factory'));
  writeFileSync(
    join(root, '.factory', 'config.json'),
    JSON.stringify({ project: PROJECT_ID }),
  );
  return root;
};

export const createHarness = (options: HarnessOptions = {}): Harness => {
  const spawned: DetachedSpec[] = [];
  const alive = new Set<number>();
  let nextPid = 1000;
  const ports: FactoryPorts = {
    clock: { now: () => Date.now(), sleep: async () => undefined },
    process: {
      spawnDetached: async (spec) => {
        spawned.push(spec);
        nextPid += 1;
        alive.add(nextPid);
        return nextPid;
      },
      isAlive: (pid) => alive.has(pid),
      terminate: (pid) => {
        alive.delete(pid);
      },
      forceKill: (pid) => {
        alive.delete(pid);
      },
    },
    hqLink: options.hqLink ?? createHqLinkClient(),
    credentials: { read: () => options.credential ?? null },
    pidFile: { read: async () => null, remove: async () => undefined },
    repoConfig: createRepoConfigAdapter(),
  };
  const local = createLocalEngine({ dbPath: ':memory:' });
  const app = createFactoryApp({
    ports,
    local,
    cellLauncher: ['cell-launcher'],
    cellsLogDir: tmpdir(),
    baseName: 'dev-box',
  });
  return { app, local, spawned, repoRoot: repoRootOf() };
};

export const jsonRequest = (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request =>
  new Request(`${FACTORY_ORIGIN}${path}`, {
    method,
    headers:
      body === undefined
        ? headers
        : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

export const readJson = async <T>(response: Response): Promise<T> =>
  (await response.json()) as T;

export const callFactory = (
  harness: Harness,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<Response> =>
  harness.app.fetch(jsonRequest(method, path, body, headers));

export const callLocal = (
  harness: Harness,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> =>
  harness.local.fetch(
    jsonRequest(method, path, body, bearer(harness.local.localToken)),
  );

export const scaleTo = (harness: Harness, count: number): Promise<Response> =>
  callFactory(harness, 'PUT', '/scale', {
    repoRoot: harness.repoRoot,
    count,
  });

export const cellEnvOf = (
  harness: Harness,
  index = 0,
): { token: string; cellId: string } => {
  const spec = harness.spawned[index];
  if (spec === undefined) {
    throw new Error(`no cell spawned at ${index}`);
  }
  const token = spec.env.HQ_TOKEN;
  const cellId = spec.env.FACTORY_CELL_ID;
  if (token === undefined || cellId === undefined) {
    throw new Error('spawned cell is missing its relay identity');
  }
  return { token, cellId };
};
