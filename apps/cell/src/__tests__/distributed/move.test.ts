import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderId } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { inheritedEnv } from './harness/process';
import {
  SERVER_MAIN,
  startFactory,
  type RunningFactory,
} from './harness/factory-proc';
import {
  createWorld,
  FEATURE_STATIONS,
  ofType,
  orderOf,
  suiteEnv,
  todo,
  until,
  type World,
} from './harness/world';

let world: World | undefined;
let moved: RunningFactory | undefined;

afterEach(async () => {
  await moved?.kill9();
  moved = undefined;
  await world?.close();
  world = undefined;
});

/** One `factory-server admin <args>` against a data directory no server runs on; returns its stdout. */
const runAdmin = async (
  dataDir: string,
  args: string[],
  env: Record<string, string>,
): Promise<string> => {
  const proc = Bun.spawn(
    ['bun', SERVER_MAIN, '--data-dir', dataDir, 'admin', ...args],
    { env: { ...inheritedEnv(), ...env }, stdout: 'pipe', stderr: 'pipe' },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      `factory-server admin ${args.join(' ')} exited ${code}: ${err}`,
    );
  }
  return out;
};

/**
 * How many passing Cycles each Station of the Line has: a completed operator Cycle, a passing verdict
 * or a passing inspection. A Cycle that was lost or handed over does not count.
 */
const passesPerStation = (events: StoredEvent[]): Record<string, number> => {
  const stationOf = new Map(
    ofType(events, 'cycle_started').map((started) => [
      started.cycleId,
      started.stationId,
    ]),
  );
  const passing = [
    ...ofType(events, 'cycle_completed').map((done) => done.cycleId),
    ...ofType(events, 'verdict_recorded')
      .filter((verdict) => verdict.pass)
      .map((verdict) => verdict.cycleId),
    ...ofType(events, 'inspection_finished')
      .filter((inspection) => inspection.passed)
      .map((inspection) => inspection.cycleId),
  ];
  const counts: Record<string, number> = {};
  for (const cycleId of passing) {
    const station = stationOf.get(cycleId);
    if (station !== undefined) counts[station] = (counts[station] ?? 0) + 1;
  }
  return counts;
};

describe('a Factory moved to another machine mid-run', () => {
  it('imports the queue into an empty Factory, the Cells re-join, and every Work order completes once', async () => {
    world = await createWorld({
      'add-export': todo('Add export'),
      'add-login': todo('Add login'),
      'add-search': todo('Add search'),
    });
    const w = world;
    const orders = ['add-export', 'add-login', 'add-search'].map(orderOf);
    const remoteA = w.factory.remoteUrl;
    if (remoteA === undefined)
      throw new Error('the remote listener did not start');
    const env = suiteEnv(w.ghDir);
    const buildStarted = async (): Promise<OrderId[]> => {
      const started: OrderId[] = [];
      for (const order of orders) {
        const events = await w.eventsOf(order);
        if (
          ofType(events, 'cycle_started').some(
            (run) => run.stationId === 'build',
          )
        ) {
          started.push(order);
        }
      }
      return started;
    };

    // Two Cells of A; each builder hangs, so two Work orders hold a job mid-Station when A moves.
    const a1 = await w.cell('cell-a1', {
      factoryUrl: remoteA,
      joinToken: await w.joinToken(),
      scenarios: { builder: 'silent' },
    });
    const a2 = await w.cell('cell-a2', {
      factoryUrl: remoteA,
      joinToken: await w.joinToken(),
      scenarios: { builder: 'silent' },
    });
    await until(
      async () => (await buildStarted()).length >= 2,
      'cells of A to hang two builds',
    );
    await a1.kill9();
    await a2.kill9();

    // The snapshot of Factory A is taken right after Cell A dies, before A stops: the lease has not
    // lapsed yet, so the reaper appends nothing in between. Then A stops cleanly (the writer lock is free).
    const before = new Map<OrderId, StoredEvent[]>();
    for (const order of orders) before.set(order, await w.eventsOf(order));
    const hung = await buildStarted();
    await w.factory.stop();

    // Export from A, import into B: an empty data directory of its own.
    const archive = join(w.root, 'factory.tar');
    await runAdmin(w.dataDir, ['export', archive], env);
    const dataB = join(w.root, 'factory-b');
    mkdirSync(dataB);
    const imported = JSON.parse(
      await runAdmin(dataB, ['import', archive], env),
    ) as {
      expired: OrderId[];
    };
    expect([...imported.expired].sort()).toEqual([...hung].sort());

    // B takes a supervisor token and a join token per Cell, then serves over HTTP.
    await runAdmin(dataB, ['token', 'create', 'ops-b'], env);
    const b = await startFactory({ dataDir: dataB, env });
    moved = b;
    if (b.remoteUrl === undefined)
      throw new Error('B did not start its remote listener');
    for (const name of ['cell-b1', 'cell-b2']) {
      const joined = await b.client.call('joinTokenCreate', {
        commandId: `join-${name}`,
        name,
      });
      await w.cell(name, { factoryUrl: b.remoteUrl, joinToken: joined.token });
    }

    await until(
      async () =>
        (await b.client.call('board', {})).orders.every(
          (row) => row.status === 'delivered',
        ),
      'every moved Work order to be delivered',
      180_000,
    );

    for (const order of orders) {
      const events = (await b.client.call('orderDetail', { orderId: order }))
        .events;
      const seen = before.get(order) ?? [];

      // A's history is an exact prefix of B's: the same envelopes, the same global sequence.
      expect(events.slice(0, seen.length)).toEqual(seen);

      // Each Work order that held a job when A stopped got it expired on import, as a lease expiry.
      if (hung.includes(order)) {
        expect(
          ofType(events, 'job_lost').some(
            (lost) => lost.reason === 'lease_expired',
          ),
        ).toBe(true);
      }

      // Every Station of the Line passed once: no duplicate passing Cycle, no duplicate delivery.
      const counts = passesPerStation(events);
      for (const station of FEATURE_STATIONS.filter((id) => id !== 'deliver')) {
        expect(counts[station], `${order} ${station}`).toBe(1);
      }
      expect(ofType(events, 'delivery_finished')).toHaveLength(1);
    }

    // One pull request per Work order on the fake GitHub.
    const prs = readdirSync(w.ghDir).filter((name) => name.endsWith('.json'));
    expect(prs).toHaveLength(orders.length);
  }, 300_000);
});
