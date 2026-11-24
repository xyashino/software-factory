import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../../../src/application/core/errors';
import { createTestWorkOrder } from '../../../../../src/application/procedures/work-orders/test.procedure';
import { createFakePorts, runProcedure } from '../../../../support/fake-ports';

const CREATED = {
  code: 201,
  order: {
    orderId: 'wo-9',
    slug: 'smoke-test-1',
    state: 'queued',
    lineName: 'fast',
    priority: 'high',
  },
};

describe('test work order', () => {
  it('queues a smoke-test chore on the fast line for the repo project', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => CREATED });

    // Act
    const created = await runProcedure(
      createTestWorkOrder,
      { configPath: '/repos/alpha/.factory/config.json' },
      fake,
    );

    // Assert
    expect(fake.calls).toEqual([
      {
        method: 'POST',
        route: '/api/v1/work-orders',
        body: {
          projectId: 'software-factory',
          slug: 'smoke-test-1',
          title: 'Smoke test runner and PR delivery',
          type: 'chore',
          description: expect.any(String),
          lineName: 'fast',
          priority: 'high',
        },
        token: 'secret-value',
      },
    ]);
    expect(created).toEqual({
      order: {
        orderId: 'wo-9',
        slug: 'smoke-test-1',
        state: 'queued',
        lineName: 'fast',
        priority: 'high',
      },
    });
  });

  it('forwards the requested line and slug', async () => {
    // Arrange
    const fake = createFakePorts({
      reply: () => ({
        ...CREATED,
        order: { ...CREATED.order, slug: 'my-smoke', lineName: 'feature' },
      }),
    });

    // Act
    await runProcedure(
      createTestWorkOrder,
      {
        configPath: '/repos/alpha/.factory/config.json',
        lineName: 'feature',
        slug: 'my-smoke',
      },
      fake,
    );

    // Assert
    expect(fake.calls[0]?.body).toMatchObject({
      slug: 'my-smoke',
      lineName: 'feature',
    });
  });

  it('refuses a repo without a repo config and sends no request', async () => {
    // Arrange
    const fake = createFakePorts({ config: null, reply: () => CREATED });

    // Act
    const attempt = runProcedure(
      createTestWorkOrder,
      { configPath: '/repos/bare/.factory/config.json' },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(ArgumentError);
    expect(fake.calls).toEqual([]);
  });
});
