import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import { listQueue } from '../../../src/application/procedures/queue/list.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const CONFIG = '/repo/.factory/config.json';

const PLANS = {
  items: [{ planId: 'plan-9', slug: 'web-demo', title: 'Web demo' }],
};

const ORDERS = {
  items: [
    {
      orderId: 'wo-1',
      state: 'queued',
      lineName: 'feature',
      priority: 'high',
      planId: 'plan-9',
      activeCellId: null,
    },
  ],
};

const replyFor = (call: { route: string }) =>
  call.route === '/api/v1/order-plans' ? PLANS : ORDERS;

describe('queue list', () => {
  it('shows each work order with its plan slug and never writes a file', async () => {
    // Arrange
    const fake = createFakePorts({ reply: replyFor });

    // Act
    const result = await runProcedure(listQueue, { configPath: CONFIG }, fake);

    // Assert
    expect(result.rows).toEqual([
      {
        orderId: 'wo-1',
        state: 'queued',
        line: 'feature',
        priority: 'high',
        plan: 'web-demo',
        activeCellId: null,
      },
    ]);
    expect(fake.writes).toEqual([]);
  });

  it('passes the plan slug as a plan id filter', async () => {
    // Arrange
    const fake = createFakePorts({ reply: replyFor });

    // Act
    await runProcedure(
      listQueue,
      { configPath: CONFIG, plan: 'web-demo', state: 'queued' },
      fake,
    );

    // Assert
    const workOrders = fake.calls.find(
      (call) => call.route === '/api/v1/work-orders',
    );
    expect(workOrders?.query).toEqual({
      projectId: 'software-factory',
      planId: 'plan-9',
      state: 'queued',
    });
  });

  it('refuses a plan slug the server does not know', async () => {
    // Arrange
    const fake = createFakePorts({ reply: replyFor });

    // Act
    const attempt = runProcedure(
      listQueue,
      { configPath: CONFIG, plan: 'missing' },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(ArgumentError);
  });
});
