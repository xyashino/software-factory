import { describe, expect, it } from 'vitest';
import {
  WORK_ORDER_STATE_LIST,
  countByState,
  findCell,
  formatLease,
  isWorkOrderState,
} from '../../src/lib/view-model';

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);

describe('countByState', () => {
  it('counts every state that appears and omits none', () => {
    // Arrange
    const orders = [
      { state: 'queued' },
      { state: 'running' },
      { state: 'queued' },
      { state: 'waiting_parent' },
    ];

    // Act
    const counts = countByState(orders);

    // Assert
    expect(counts).toEqual({ queued: 2, running: 1, waiting_parent: 1 });
  });
});

describe('findCell', () => {
  it('returns the cell with the given id', () => {
    // Arrange
    const cells = [{ cellId: 'cell-1' }, { cellId: 'cell-2' }];

    // Act
    const cell = findCell(cells, 'cell-2');

    // Assert
    expect(cell).toEqual({ cellId: 'cell-2' });
  });

  it('returns undefined for an unknown id', () => {
    // Arrange
    const cells = [{ cellId: 'cell-1' }];

    // Act
    const cell = findCell(cells, 'unknown');

    // Assert
    expect(cell).toBeUndefined();
  });
});

describe('formatLease', () => {
  it('returns null when the cell has no lease', () => {
    // Arrange
    const leaseExpiresAt = null;

    // Act
    const lease = formatLease(leaseExpiresAt, NOW);

    // Assert
    expect(lease).toBeNull();
  });

  it('shows the expiry time and time left for an active lease', () => {
    // Arrange
    const leaseExpiresAt = NOW + 4 * 60_000 + 12_000;

    // Act
    const lease = formatLease(leaseExpiresAt, NOW);

    // Assert
    expect(lease).toBe('2026-11-19T12:04:12.000Z (in 4m 12s)');
  });

  it('marks a lease that has passed as expired', () => {
    // Arrange
    const leaseExpiresAt = NOW - 1_000;

    // Act
    const lease = formatLease(leaseExpiresAt, NOW);

    // Assert
    expect(lease).toBe('2026-11-19T11:59:59.000Z (expired)');
  });
});

describe('isWorkOrderState', () => {
  it('accepts every state the server defines', () => {
    // Arrange
    const states = WORK_ORDER_STATE_LIST;

    // Act
    const accepted = states.every((state) => isWorkOrderState(state));

    // Assert
    expect(accepted).toBe(true);
  });

  it('rejects a state the server does not define', () => {
    // Arrange
    const state = 'bogus';

    // Act
    const accepted = isWorkOrderState(state);

    // Assert
    expect(accepted).toBe(false);
  });
});
