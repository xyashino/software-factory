import { describe, expect, it } from 'vitest';
import {
  listIncidentsContract,
  resolveIncidentContract,
} from '../../../src/contracts/incidents.contract';

const body = resolveIncidentContract.in.body;

describe('incidents contract', () => {
  it('accepts a list query filtered by reason', () => {
    // Arrange
    const query = { projectId: 'factory', reason: 'operator_blocked' };

    // Act
    const result = listIncidentsContract.in.query.safeParse(query);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a list query with an unknown reason', () => {
    // Arrange
    const query = { projectId: 'factory', reason: 'bored' };

    // Act
    const result = listIncidentsContract.in.query.safeParse(query);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a retry_step resolution with a step index', () => {
    // Arrange
    const input = { action: 'retry_step', stepIndex: 2 };

    // Act
    const result = body.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a resolution with an unknown key', () => {
    // Arrange
    const input = { action: 'escalate', extra: true };

    // Act
    const result = body.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});
