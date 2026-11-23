import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { workOrders } from '../../src/db/schema/orders';
import { asOrderId } from '../../src/domain/common/brand';
import type { Db } from '../../src/db/client';
import { createTestApp, postJson, type TestApp } from '../support/test-app';
import { seedBaseline } from '../support/test-db';
import {
  claimBody,
  factoryHeaders,
  FACTORY_TOKEN,
  seedFactory,
} from '../support/factory-session';

const PROJECT_ID = 'proj-1';
const SECOND_FACTORY_TOKEN = 'sf_factory_second-token';

const setup = () => {
  const { app, clock, db } = createTestApp({ safeTokenAuth: true });
  seedBaseline(db);
  seedFactory(db, 'factory-2', SECOND_FACTORY_TOKEN, clock.now());
  return { app, db };
};

const claim = async (
  app: TestApp,
  cellId: string,
  token: string = FACTORY_TOKEN,
): Promise<{ job: { orderId: string; epoch: number } | null }> => {
  const response = await postJson(
    app,
    '/api/v1/cells/claims',
    claimBody({}, PROJECT_ID),
    factoryHeaders(cellId, token),
  );
  return (await response.json()) as {
    job: { orderId: string; epoch: number } | null;
  };
};

const orderRow = (db: Db, orderId: string) =>
  db
    .select()
    .from(workOrders)
    .where(eq(workOrders.orderId, asOrderId(orderId)))
    .get();

describe('cells of one factory', () => {
  it('two cells of one factory both claim their own order', async () => {
    const { app } = setup();

    const first = await claim(app, 'cell-aaaaaaaa');
    const second = await claim(app, 'cell-bbbbbbbb');

    expect(first.job?.orderId).toBe('order-1');
    expect(second.job?.orderId).toBe('order-2');
  });

  it('a claim needs only the factory credential and a cell id header', async () => {
    const { app } = setup();

    const response = await postJson(
      app,
      '/api/v1/cells/claims',
      claimBody({}, PROJECT_ID),
      factoryHeaders('cell-cccccccc'),
    );

    expect(response.status).toBe(200);
  });

  it('an order pinned to a live factory is not claimed by another factory', async () => {
    const { app, db } = setup();
    await claim(app, 'cell-aaaaaaaa');
    const parked = await claim(app, 'cell-bbbbbbbb');

    const other = await claim(app, 'cell-cccccccc', SECOND_FACTORY_TOKEN);

    expect(parked.job?.orderId).toBe('order-2');
    expect(other.job).toBeNull();
    expect(orderRow(db, 'order-1')).toMatchObject({
      pinnedFactoryId: 'factory-1',
    });
  });
});
