import { afterEach, describe, expect, it } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { CellId, JobId } from '@repo/factory-core/ids';
import { readIdentity } from '../../identity';
import { remoteFactoryClient } from '../../remote-client';
import { cellPathsIn, isAlive, runsIn } from './harness/cell-proc';
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

describe('a Cell cut off from the Factory', () => {
  it('fences itself, lets another Cell take over, and is refused with stale_epoch on return', async () => {
    world = await createWorld({ 'add-login': todo('Add login') });
    const w = world;
    const order = orderOf('add-login');
    const remoteUrl = w.factory.remoteUrl;
    if (remoteUrl === undefined)
      throw new Error('the remote listener did not start');

    // Cell A talks to the Factory through its own proxy; its builder hangs in the build Station.
    const proxyA = w.proxyFor(remoteUrl);
    const a = await w.cell('cell-a', {
      factoryUrl: proxyA.url,
      joinToken: await w.joinToken(),
      scenarios: { builder: 'silent' },
    });
    await until(
      async () =>
        ofType(await w.eventsOf(order), 'cycle_started').some(
          (started) => started.stationId === 'build',
        ),
      'cell A to start the build',
    );
    const cycle = ofType(await w.eventsOf(order), 'cycle_started').find(
      (started) => started.stationId === 'build',
    );
    const claimed = ofType(await w.eventsOf(order), 'job_claimed').at(-1);
    if (cycle === undefined || claimed === undefined) {
      throw new Error('cell A holds no build job');
    }
    const staleJob: JobId = claimed.jobId;
    const staleEpoch = claimed.epoch;
    const staleCycle = cycle.cycleId;

    // The partition starts once A's builder is running, so the cut lands mid-Cycle.
    await until(
      () => runsIn(a.root).some((run) => run.role === 'builder'),
      'cell A to start its builder',
    );
    // The partition: A's requests stop reaching the Factory.
    proxyA.cut();
    await until(
      () => a.output().includes('self-fence'),
      'cell A to fence itself',
      30_000,
    );
    // A fence stops every job: the runner A started for the build is gone too.
    const runner = runsIn(a.root).find((run) => run.role === 'builder');
    if (runner === undefined) throw new Error('cell A started no builder');
    await until(() => !isAlive(runner.pid), 'the fenced runner to exit');

    // B joins through a path of its own and takes the Station once A's lease lapses.
    const proxyB = w.proxyFor(remoteUrl);
    await w.cell('cell-b', {
      factoryUrl: proxyB.url,
      joinToken: await w.joinToken(),
    });
    await until(
      async () => (await statusOf(w, 'add-login')) === 'delivered',
      'cell B to deliver the Work order',
      60_000,
    );

    // The partition heals: A is back, and its late command carries the epoch it lost.
    proxyA.heal();
    const identity = readIdentity(cellPathsIn(a.root).cellDataDir);
    if (identity?.credential === undefined)
      throw new Error('cell A has no credential');
    const returned: FactoryClient = remoteFactoryClient({
      baseUrl: proxyA.url,
      credential: identity.credential,
      attempts: 1,
    });
    const late = await returned
      .call('submitCommand', {
        cellId: identity.cellId as CellId,
        jobId: staleJob,
        orderId: order,
        commandId: `late-${staleJob}`,
        epoch: staleEpoch,
        command: {
          type: 'FailCycle',
          cycleId: staleCycle,
          reason: 'crashed',
          detail: 'late report from a fenced Cell',
        },
      })
      .catch((error: unknown) => error);
    expect(late).toBeInstanceOf(WireFailure);
    expect((late as WireFailure).error.code).toBe('stale_epoch');

    // No push from the fenced Cell: the branch holds the commit B delivered, and nothing A sent.
    const events = await w.eventsOf(order);
    const delivered = ofType(events, 'delivery_finished');
    expect(delivered).toHaveLength(1);
    expect(await remoteTip(w, 'factory/add-login')).toBe(delivered[0]?.commit);

    // Nothing A did lands after its job was lost.
    const lostAt = events.findIndex(
      (stored) =>
        stored.event.type === 'job_lost' && stored.event.jobId === staleJob,
    );
    expect(lostAt).toBeGreaterThanOrEqual(0);
    const afterLoss = events.slice(lostAt + 1);
    expect(
      afterLoss.some(
        (stored) =>
          stored.event.type === 'cycle_started' &&
          stored.event.jobId === staleJob,
      ),
    ).toBe(false);
    expect(
      afterLoss.some(
        (stored) =>
          'cycleId' in stored.event && stored.event.cycleId === staleCycle,
      ),
    ).toBe(false);
  }, 150_000);
});
