import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import { runQueueAction } from '../../../src/application/procedures/queue/actions.procedure';
import { createFakePorts, runProcedure } from '../../support/fake-ports';

const base = {
  orderIds: ['wo-1', 'wo-2'],
  yes: false,
};

const ACTED = {
  orders: [{ orderId: 'wo-1', state: 'cancelled', priority: 'medium' }],
};

describe('queue actions', () => {
  it('refuses cancel without --yes and sends no request', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => ACTED });

    // Act
    const attempt = runProcedure(
      runQueueAction,
      { ...base, action: 'cancel' },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(ArgumentError);
    await expect(attempt).rejects.toThrow('wo-1, wo-2');
    expect(fake.calls).toEqual([]);
  });

  it('sends cancel once --yes is given', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => ACTED });

    // Act
    await runProcedure(
      runQueueAction,
      { ...base, action: 'cancel', yes: true },
      fake,
    );

    // Assert
    expect(fake.calls[0]).toMatchObject({
      method: 'POST',
      route: '/api/v1/queue/actions',
      body: { action: 'cancel', orderIds: ['wo-1', 'wo-2'] },
    });
  });

  it('refuses reprioritise without a priority and sends no request', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => ACTED });

    // Act
    const attempt = runProcedure(
      runQueueAction,
      { ...base, action: 'reprioritise' },
      fake,
    );

    // Assert
    await expect(attempt).rejects.toBeInstanceOf(ArgumentError);
    expect(fake.calls).toEqual([]);
  });

  it('sends reprioritise with the chosen priority', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => ACTED });

    // Act
    await runProcedure(
      runQueueAction,
      { ...base, action: 'reprioritise', priority: 'high' },
      fake,
    );

    // Assert
    expect(fake.calls[0]?.body).toEqual({
      action: 'reprioritise',
      orderIds: ['wo-1', 'wo-2'],
      priority: 'high',
    });
  });

  it('maps reset to the server action reset_to_scratch', async () => {
    // Arrange
    const fake = createFakePorts({ reply: () => ACTED });

    // Act
    await runProcedure(runQueueAction, { ...base, action: 'reset' }, fake);

    // Assert
    expect(fake.calls[0]?.body).toEqual({
      action: 'reset_to_scratch',
      orderIds: ['wo-1', 'wo-2'],
    });
  });
});
