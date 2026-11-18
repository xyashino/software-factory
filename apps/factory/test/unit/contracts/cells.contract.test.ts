import { describe, expect, it } from 'vitest';
import {
  claimJobContract,
  enrollCellContract,
  heartbeatCellContract,
  helloCellContract,
} from '../../../src/contracts/cells.contract';

describe('cells contract', () => {
  it('accepts an enroll body with the known fields', () => {
    // Arrange
    const body = {
      projectId: 'factory',
      name: 'cell-one',
      allowedLines: ['*'],
      runners: ['claude'],
    };

    // Act
    const result = enrollCellContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects an enroll body with an unknown key', () => {
    // Arrange
    const body = {
      projectId: 'factory',
      name: 'cell-one',
      allowedLines: ['*'],
      runners: ['claude'],
      extra: true,
    };

    // Act
    const result = enrollCellContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(false);
  });

  it('defaults hello local worktrees to an empty list', () => {
    // Arrange
    const body = {
      projectId: 'factory',
      allowedLines: ['main'],
      runners: ['claude'],
    };

    // Act
    const result = helloCellContract.in.body.safeParse(body);

    // Assert
    expect(result.success && result.data.localWorktrees).toEqual([]);
  });

  it('rejects a hello body with an unknown key', () => {
    // Arrange
    const body = {
      projectId: 'factory',
      allowedLines: ['main'],
      runners: ['claude'],
      unknown: 1,
    };

    // Act
    const result = helloCellContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a claim body and an absent claim body', () => {
    // Arrange
    const withWait = { waitMs: 25000 };

    // Act
    const parsedWait = claimJobContract.in.body.safeParse(withWait);
    const parsedAbsent = claimJobContract.in.body.safeParse(undefined);

    // Assert
    expect(parsedWait.success).toBe(true);
    expect(parsedAbsent.success).toBe(true);
  });

  it('rejects a claim body with an unknown key', () => {
    // Arrange
    const body = { waitMs: 1, extra: true };

    // Act
    const result = claimJobContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(false);
  });

  it('accepts a heartbeat body with job and epoch', () => {
    // Arrange
    const body = { jobId: 'job-1', epoch: 2 };

    // Act
    const result = heartbeatCellContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });

  it('rejects a heartbeat body with an unknown key', () => {
    // Arrange
    const body = { jobId: 'job-1', epoch: 2, extra: true };

    // Act
    const result = heartbeatCellContract.in.body.safeParse(body);

    // Assert
    expect(result.success).toBe(false);
  });
});
