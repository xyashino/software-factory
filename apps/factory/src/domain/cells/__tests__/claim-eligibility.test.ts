import { describe, expect, it } from 'vitest';
import { asCellId, asJobId, asOrderId, asProjectId } from '../../common/brand';
import {
  isEligible,
  selectClaimable,
  type ClaimCandidate,
  type ClaimCell,
  type ClaimContext,
} from '../claim-eligibility';

const cellA: ClaimCell = {
  cellId: asCellId('cell-a'),
  projectId: asProjectId('project-1'),
  allowedLines: ['web'],
  localWorktrees: [],
};

const openContext: ClaimContext = { runningCount: 0, maxRunning: 2 };

const makeCandidate = (
  overrides: Partial<ClaimCandidate> = {},
): ClaimCandidate => ({
  orderId: asOrderId('order-1'),
  projectId: asProjectId('project-1'),
  state: 'queued',
  priority: 'medium',
  lineName: 'web',
  createdAt: 1,
  pinnedCellId: null,
  pinnedCellUnavailable: false,
  activeCellId: null,
  activeJobId: null,
  unavailableLineCells: [],
  ...overrides,
});

describe('claim eligibility', () => {
  it('rejects a candidate from another project', () => {
    const candidate = makeCandidate({ projectId: asProjectId('project-2') });

    expect(isEligible(candidate, cellA, openContext)).toBe(false);
  });

  it('accepts a candidate whose line is in the cell allowed lines', () => {
    const candidate = makeCandidate({ lineName: 'web' });

    expect(isEligible(candidate, cellA, openContext)).toBe(true);
  });

  it('accepts any line when the cell allows the wildcard line', () => {
    const cell: ClaimCell = { ...cellA, allowedLines: ['*'] };
    const candidate = makeCandidate({ lineName: 'api' });

    expect(isEligible(candidate, cell, openContext)).toBe(true);
  });

  it('rejects a candidate whose line the cell does not allow', () => {
    const candidate = makeCandidate({ lineName: 'api' });

    expect(isEligible(candidate, cellA, openContext)).toBe(false);
  });

  it('rejects a candidate when this cell is listed as unavailable for its line', () => {
    const candidate = makeCandidate({
      unavailableLineCells: [asCellId('cell-a')],
    });

    expect(isEligible(candidate, cellA, openContext)).toBe(false);
  });

  it('rejects a candidate pinned to another cell that is still online', () => {
    const candidate = makeCandidate({
      pinnedCellId: asCellId('cell-b'),
      pinnedCellUnavailable: false,
    });

    expect(isEligible(candidate, cellA, openContext)).toBe(false);
  });

  it('accepts a candidate pinned to this cell', () => {
    const candidate = makeCandidate({ pinnedCellId: asCellId('cell-a') });

    expect(isEligible(candidate, cellA, openContext)).toBe(true);
  });

  it('accepts a candidate whose pinned cell lease has expired', () => {
    const candidate = makeCandidate({
      pinnedCellId: asCellId('cell-b'),
      pinnedCellUnavailable: true,
    });

    expect(isEligible(candidate, cellA, openContext)).toBe(true);
  });

  it('rejects any candidate once the project has reached max running', () => {
    const candidate = makeCandidate();
    const full: ClaimContext = { runningCount: 2, maxRunning: 2 };

    expect(isEligible(candidate, cellA, full)).toBe(false);
  });

  it('accepts a candidate while the project is below max running', () => {
    const candidate = makeCandidate();
    const almostFull: ClaimContext = { runningCount: 1, maxRunning: 2 };

    expect(isEligible(candidate, cellA, almostFull)).toBe(true);
  });

  it('rejects a candidate that is not queued', () => {
    const candidate = makeCandidate({ state: 'paused' });

    expect(isEligible(candidate, cellA, openContext)).toBe(false);
  });

  it('rejects a candidate already held by a cell or job', () => {
    const heldByCell = makeCandidate({ activeCellId: asCellId('cell-b') });
    const heldByJob = makeCandidate({ activeJobId: asJobId('job-1') });

    expect(isEligible(heldByCell, cellA, openContext)).toBe(false);
    expect(isEligible(heldByJob, cellA, openContext)).toBe(false);
  });
});

describe('claim ordering', () => {
  it('puts a warm worktree ahead of a higher priority cold order', () => {
    const cell: ClaimCell = { ...cellA, localWorktrees: [asOrderId('warm')] };
    const cold = makeCandidate({
      orderId: asOrderId('cold'),
      priority: 'high',
    });
    const warm = makeCandidate({
      orderId: asOrderId('warm'),
      priority: 'low',
    });

    const claimed = selectClaimable([cold, warm], cell, openContext);

    expect(claimed.map((c) => c.orderId)).toEqual(['warm', 'cold']);
  });

  it('treats an order pinned to this cell as warm', () => {
    const pinned = makeCandidate({
      orderId: asOrderId('pinned'),
      priority: 'low',
      pinnedCellId: asCellId('cell-a'),
    });
    const cold = makeCandidate({
      orderId: asOrderId('cold'),
      priority: 'high',
    });

    const claimed = selectClaimable([cold, pinned], cellA, openContext);

    expect(claimed.map((c) => c.orderId)).toEqual(['pinned', 'cold']);
  });

  it('orders candidates from high to low priority', () => {
    const low = makeCandidate({ orderId: asOrderId('low'), priority: 'low' });
    const high = makeCandidate({
      orderId: asOrderId('high'),
      priority: 'high',
    });
    const medium = makeCandidate({
      orderId: asOrderId('medium'),
      priority: 'medium',
    });

    const claimed = selectClaimable([low, medium, high], cellA, openContext);

    expect(claimed.map((c) => c.orderId)).toEqual(['high', 'medium', 'low']);
  });

  it('breaks priority ties by the oldest created order first', () => {
    const newer = makeCandidate({ orderId: asOrderId('newer'), createdAt: 20 });
    const older = makeCandidate({ orderId: asOrderId('older'), createdAt: 10 });

    const claimed = selectClaimable([newer, older], cellA, openContext);

    expect(claimed.map((c) => c.orderId)).toEqual(['older', 'newer']);
  });

  it('leaves the input candidates in their original order', () => {
    const first = makeCandidate({
      orderId: asOrderId('first'),
      priority: 'low',
    });
    const second = makeCandidate({
      orderId: asOrderId('second'),
      priority: 'high',
    });
    const input = [first, second];

    selectClaimable(input, cellA, openContext);

    expect(input.map((c) => c.orderId)).toEqual(['first', 'second']);
  });

  it('returns only the candidates the cell may claim', () => {
    const eligible = makeCandidate({ orderId: asOrderId('eligible') });
    const otherProject = makeCandidate({
      orderId: asOrderId('other'),
      projectId: asProjectId('project-2'),
    });

    const claimed = selectClaimable(
      [otherProject, eligible],
      cellA,
      openContext,
    );

    expect(claimed.map((c) => c.orderId)).toEqual(['eligible']);
  });
});
