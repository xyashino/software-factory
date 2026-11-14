import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoredEvent } from '@repo/factory-core/order/events';
import type { OrderId, ProjectId } from '@repo/factory-core/ids';
import { seedProject } from '@repo/factory-runtime/seed';
import {
  createFixtureRepo,
  todoFile,
} from '@repo/factory-server/__tests__/e2e/fixture-repo';
import { startHttpProxy, type HttpProxy } from './tcp-proxy';
import { startCell, type CellOptions, type RunningCell } from './cell-proc';
import {
  startFactory,
  SUITE_TIMING,
  type RunningFactory,
} from './factory-proc';
import { waitFor } from './process';

export const PROJECT = 'software-factory' as ProjectId;

/** The fake runner shims (`claude`, `cursor-agent`) and fake `gh`, put first on PATH. */
export const FAKE_BIN = fileURLToPath(new URL('./fake-bin', import.meta.url));

/**
 * The project the fixture repository is: a real pnpm project with no dependencies, so the Line's setup
 * (`pnpm install --frozen-lockfile`) and its checks (`pnpm check-types|lint|test`) run as they would in a
 * repository. `node_modules` is ignored, as it is in any real repository, so a check never dirties the tree.
 */
const PROJECT_FILES: Record<string, string> = {
  '.gitignore': 'node_modules/\n',
  'package.json': `${JSON.stringify(
    {
      name: 'fixture',
      private: true,
      scripts: {
        'check-types': 'node -e 0',
        lint: 'node -e 0',
        test: 'node -e 0',
      },
    },
    null,
    2,
  )}\n`,
  'pnpm-lock.yaml': `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .: {}
`,
};

/** The Line the fixture todos run: the feature Line, plan through deliver. */
export const FEATURE_STATIONS = [
  'plan',
  'plan-review',
  'build',
  'quality-gate',
  'audit',
  'deliver',
];

export interface World {
  /** The temp root of this test; removed by `close`. */
  readonly root: string;
  /** The Factory's data directory. */
  readonly dataDir: string;
  /** The fixture repository: the git remote the mirror clones and the Cells push to. */
  readonly repo: string;
  /** The fake GitHub: one JSON file per pull request. */
  readonly ghDir: string;
  /** The Factory process as it runs now. */
  factory: RunningFactory;
  /** Starts the Factory again on the same data directory (after a kill). */
  restartFactory(): Promise<RunningFactory>;
  /** A join token for a remote Cell, minted through the Factory. */
  joinToken(): Promise<string>;
  /** Starts a Cell in its own directory under the root. */
  cell(name: string, options?: Partial<CellOptions>): Promise<RunningCell>;
  /** A hostile proxy in front of the Factory's HTTP listener; needs a remote Factory. */
  proxyFor(upstreamUrl: string): HttpProxy;
  /** Every event of one Work order, in order. */
  eventsOf(orderId: OrderId): Promise<StoredEvent[]>;
  /** Stops every process and removes the root. */
  close(): Promise<void>;
}

/** The environment every process of the suite runs in: the fake shims first, the suite's timings. */
export const suiteEnv = (ghDir: string): Record<string, string> => ({
  PATH: `${FAKE_BIN}:${process.env.PATH ?? ''}`,
  FAKE_GH_DIR: ghDir,
  FACTORY_LEASE_TTL_MS: String(SUITE_TIMING.leaseTtlMs),
  FACTORY_HEARTBEAT_MS: String(SUITE_TIMING.heartbeatMs),
  FACTORY_REAPER_MS: String(SUITE_TIMING.reaperMs),
  FACTORY_SELF_FENCE_MS: String(SUITE_TIMING.selfFenceMs),
  FACTORY_CLAIM_TICK_MS: String(SUITE_TIMING.claimTickMs),
});

/**
 * A fresh suite world: a temp root, the fixture repository with the given todo files, the project seeded
 * on it, and one Factory process (remote or local) that has synced intake, so the Work orders exist.
 */
export const createWorld = async (
  todos: Record<string, string>,
  options: { remote?: boolean } = {},
): Promise<World> => {
  const root = mkdtempSync(join(tmpdir(), 'factory-distributed-'));
  const dataDir = join(root, 'data');
  const ghDir = join(root, 'gh');
  mkdirSync(dataDir);
  mkdirSync(ghDir);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  for (const [name, text] of Object.entries(PROJECT_FILES)) {
    await Bun.write(join(repo, name), text);
  }
  await createFixtureRepo(repo, todos);
  seedProject(dataDir, { projectId: PROJECT, repoUrl: repo });

  const env = suiteEnv(ghDir);
  const start = async (): Promise<RunningFactory> => {
    const factory = await startFactory({
      dataDir,
      env,
      ...(options.remote === true ? { remote: true } : {}),
    });
    return factory;
  };
  let factory = await start();
  await factory.client.call('intakeSync', {});

  const proxies: HttpProxy[] = [];
  const cells: RunningCell[] = [];
  let joins = 0;

  return {
    root,
    dataDir,
    repo,
    ghDir,
    get factory() {
      return factory;
    },
    async restartFactory() {
      factory = await start();
      return factory;
    },
    async joinToken() {
      joins += 1;
      const created = await factory.client.call('joinTokenCreate', {
        commandId: `join-${joins}`,
        name: 'pool',
      });
      return created.token;
    },
    async cell(name, cellOptions = {}) {
      const started = await startCell(name, {
        root: join(root, 'cells', name),
        factoryDataDir: dataDir,
        ghDir,
        fakeBin: FAKE_BIN,
        env,
        ...cellOptions,
      });
      cells.push(started);
      return started;
    },
    proxyFor(upstreamUrl) {
      const proxy = startHttpProxy(upstreamUrl);
      proxies.push(proxy);
      return proxy;
    },
    async eventsOf(orderId) {
      return (await factory.client.call('orderDetail', { orderId })).events;
    },
    async close() {
      for (const cell of cells.splice(0)) {
        if (cell.alive()) await cell.kill9();
      }
      for (const proxy of proxies.splice(0)) proxy.stop();
      await factory.kill9();
      rmSync(root, { recursive: true, force: true });
    },
  };
};

/** One fixture todo: a Work order on the feature Line, named as a todo file. */
export const todo = (title: string): string => todoFile({ title, v2: true });

/** The Work order id of one todo file of the fixture. */
export const orderOf = (name: string): OrderId =>
  `${PROJECT}:${name}` as OrderId;

/** Resolves once `predicate` holds, polling the world's state; rejects after `timeoutMs`. */
export const until = (
  predicate: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs?: number,
): Promise<void> => waitFor(predicate, what, timeoutMs);

/** The status the board shows for one Work order (`delivered`, `in_progress`, ...). */
export const statusOf = async (
  w: World,
  name: string,
): Promise<string | undefined> => {
  const { orders } = await w.factory.client.call('board', {});
  return orders.find((row) => row.orderId === orderOf(name))?.status;
};

/** Events of one type, in order. */
export const ofType = <T extends StoredEvent['event']['type']>(
  events: StoredEvent[],
  type: T,
): Extract<StoredEvent['event'], { type: T }>[] =>
  events
    .map((stored) => stored.event)
    .filter(
      (event): event is Extract<StoredEvent['event'], { type: T }> =>
        event.type === type,
    );

/** The commit a bare branch of the fixture remote points at, or undefined when it has none. */
export const remoteTip = async (
  w: World,
  branch: string,
): Promise<string | undefined> => {
  const proc = Bun.spawn(
    [
      'git',
      '-C',
      w.repo,
      'rev-parse',
      '--verify',
      '-q',
      `refs/heads/${branch}`,
    ],
    { stdout: 'pipe', stderr: 'ignore' },
  );
  const text = (await new Response(proc.stdout).text()).trim();
  return (await proc.exited) === 0 && text !== '' ? text : undefined;
};
