import { afterEach, describe, expect, it } from 'vitest';
import { runsIn } from './harness/cell-proc';
import {
  createWorld,
  ofType,
  orderOf,
  remoteTip,
  statusOf,
  todo,
  until,
  type World,
} from './harness/world';

let world: World | undefined;

afterEach(async () => {
  await world?.close();
  world = undefined;
});

describe('a Cell killed with kill -9 mid-Cycle', () => {
  it('lets another Cell restart the Station, with no double work and one delivery', async () => {
    world = await createWorld({ 'add-login': todo('Add login') });
    const w = world;
    const order = orderOf('add-login');

    // Cell A runs the plan and the review, then its builder hangs in the build Station.
    const a = await w.cell('cell-a', { scenarios: { builder: 'silent' } });
    await until(
      async () =>
        ofType(await w.eventsOf(order), 'cycle_started').some(
          (started) => started.stationId === 'build',
        ),
      'cell A to start the build',
    );

    // The Cycle is open before its runner starts: kill only once the runner of the build is running.
    await until(
      () => runsIn(a.root).some((run) => run.role === 'builder'),
      'cell A to start its builder',
    );
    await a.kill9();
    // Cell B joins only now: it runs the Station A left behind once the lease lapses.
    const b = await w.cell('cell-b');

    await until(
      async () => (await statusOf(w, 'add-login')) === 'delivered',
      'the Work order to be delivered by cell B',
      60_000,
    );

    const events = await w.eventsOf(order);
    const buildCycles = ofType(events, 'cycle_started').filter(
      (started) => started.stationId === 'build',
    );
    expect(buildCycles).toHaveLength(2);

    const epochs = ofType(events, 'job_claimed').map((claim) => claim.epoch);
    expect(new Set(epochs).size).toBe(epochs.length);
    expect(epochs).toEqual([...epochs].sort((x, y) => x - y));

    expect(ofType(events, 'job_lost').length).toBeGreaterThanOrEqual(1);
    // The plan and the build complete; the review is a verdict; the killed build never completed.
    expect(ofType(events, 'cycle_completed')).toHaveLength(2);
    expect(ofType(events, 'delivery_finished')).toHaveLength(1);

    const builds = [...runsIn(a.root), ...runsIn(b.root)].filter(
      (run) => run.role === 'builder',
    );
    expect(builds.map((run) => run.scenario)).toEqual(['silent', 'done']);

    expect(await remoteTip(w, 'factory/add-login')).toBeDefined();
  }, 120_000);
});
