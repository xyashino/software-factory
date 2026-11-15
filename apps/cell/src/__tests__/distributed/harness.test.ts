import { afterEach, describe, expect, it } from 'vitest';
import { until, createWorld, orderOf, todo, type World } from './harness/world';

let world: World | undefined;

afterEach(async () => {
  await world?.close();
  world = undefined;
});

/** The status the board shows for one Work order. */
const statusOf = async (
  w: World,
  name: string,
): Promise<string | undefined> => {
  const { orders } = await w.factory.client.call('board', {});
  return orders.find((row) => row.orderId === orderOf(name))?.status;
};

describe('the distributed harness', () => {
  it('starts one Factory and one Cell behind the proxy, and delivers one Work order end to end', async () => {
    world = await createWorld({ 'add-login': todo('Add login') });
    const remoteUrl = world.factory.remoteUrl;
    if (remoteUrl === undefined)
      throw new Error('the remote listener did not start');
    const proxy = world.proxyFor(remoteUrl);
    const joinToken = await world.joinToken();

    await world.cell('cell-a', { factoryUrl: proxy.url, joinToken });

    await until(
      async () => (await statusOf(world!, 'add-login')) === 'delivered',
      'the Work order to be delivered',
      60_000,
    );
    expect(proxy.seen.length).toBeGreaterThan(0);
    expect(proxy.answered.length).toBeGreaterThan(0);
  }, 90_000);

  it('stops a Factory on SIGTERM and starts it again on the same data', async () => {
    world = await createWorld({ 'add-login': todo('Add login') });
    await world.factory.stop();
    const again = await world.restartFactory();
    const { orders } = await again.client.call('board', {});
    expect(orders.map((row) => row.orderId)).toEqual([orderOf('add-login')]);
  }, 60_000);
});
