import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredEvent } from '@repo/factory-core/order/events';
import type { RunningCell } from './harness/cell-proc';
import {
  createWorld,
  ofType,
  orderOf,
  remoteTip,
  todo,
  until,
  type World,
} from './harness/world';

/** Ten Cells, fifty Work orders: the race of ROADMAP v2-15. The seed is fixed, so a failure replays. */
const CELLS = 10;
const ORDERS = 50;
const SEED = 20_260_614;
/** Joins and leaves while the Work orders run. */
const CHURN_STEPS = 8;
/** The time the race may take before it is a failure (the plan's three to four minutes). */
const BUDGET_MS = 230_000;

let world: World | undefined;

afterEach(async () => {
  await world?.close();
  world = undefined;
});

/** A seeded pseudo-random source (mulberry32): the same seed gives the same churn, every run. */
const seeded = (seed: number): (() => number) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One lease at a time: every claim takes a newer epoch than the last, and a Cycle only starts under the
 * newest claim, so no Cell that lost its job starts work on it.
 */
const assertOneLeaseAtATime = (events: StoredEvent[]): void => {
  const epochOfJob = new Map<string, number>();
  let newest = 0;
  for (const stored of events) {
    const event = stored.event;
    if (event.type === 'job_claimed') {
      expect(event.epoch).toBeGreaterThan(newest);
      newest = event.epoch;
      epochOfJob.set(event.jobId, event.epoch);
    }
    if (event.type === 'cycle_started') {
      expect(epochOfJob.get(event.jobId)).toBe(newest);
    }
  }
};

describe('ten Cells, fifty Work orders, Cells joining and leaving', () => {
  it('delivers every Work order exactly once, with one lease at a time', async () => {
    const names = Array.from(
      { length: ORDERS },
      (_, index) => `todo-${String(index + 1).padStart(2, '0')}`,
    );
    world = await createWorld(
      Object.fromEntries(
        names.map((name, index) => [name, todo(`Todo ${index + 1}`)]),
      ),
      { remote: true },
    );
    const w = world;
    const remoteUrl = w.factory.remoteUrl;
    if (remoteUrl === undefined)
      throw new Error('the remote listener did not start');
    const random = seeded(SEED);

    const live: RunningCell[] = [];
    let joins = 0;
    let leaves = 0;
    const join = async (): Promise<void> => {
      joins += 1;
      const proxy = w.proxyFor(remoteUrl);
      live.push(
        await w.cell(`cell-${joins}`, {
          factoryUrl: proxy.url,
          joinToken: await w.joinToken(),
          slots: 2,
        }),
      );
    };
    const deliveredCount = async (): Promise<number> => {
      const { orders } = await w.factory.client.call('board', {});
      return orders.filter((row) => row.status === 'delivered').length;
    };

    for (let index = 0; index < CELLS; index += 1) await join();

    // Churn: a Cell leaves (SIGTERM, or kill -9 with its runner) and a new one joins in its place.
    for (let step = 0; step < CHURN_STEPS; step += 1) {
      await sleep(1_000 + random() * 1_000);
      if ((await deliveredCount()) === ORDERS) break;
      const alive = live.filter((cell) => cell.alive());
      if (alive.length <= 3) continue;
      const victim = alive[Math.floor(random() * alive.length)];
      if (victim === undefined) continue;
      live.splice(live.indexOf(victim), 1);
      leaves += 1;
      if (random() < 0.5) await victim.term();
      else await victim.kill9();
      await join();
    }

    await until(
      async () => (await deliveredCount()) === ORDERS,
      `all ${ORDERS} Work orders delivered (seed ${SEED})`,
      BUDGET_MS,
    );

    // The churn happened: Cells joined and left while the work ran.
    expect(joins).toBeGreaterThan(CELLS);
    expect(leaves).toBeGreaterThan(0);

    for (const name of names) {
      const events = await w.eventsOf(orderOf(name));
      const delivered = ofType(events, 'delivery_finished');

      // Exactly one delivery per order, and the branch holds the commit that delivery named.
      expect(delivered, `${name} delivered once (seed ${SEED})`).toHaveLength(
        1,
      );
      expect(await remoteTip(w, `factory/${name}`), name).toBe(
        delivered[0]?.commit,
      );
      assertOneLeaseAtATime(events);
    }

    // One pull request per order, in the fake GitHub.
    const pullRequests = readdirSync(w.ghDir).filter((file) =>
      file.endsWith('.json'),
    );
    expect(pullRequests).toHaveLength(ORDERS);
  }, 300_000);
});
