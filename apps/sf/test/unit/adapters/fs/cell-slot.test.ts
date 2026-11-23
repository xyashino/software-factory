import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claimCellSlot,
  releaseCellSlot,
} from '../../../../src/adapters/fs/cell-slot';

const freshRepo = (): string => mkdtempSync(join(tmpdir(), 'factory-slot-'));

describe('cell slot', () => {
  it('lets a second claim of the same name wait until the first releases it', async () => {
    // Arrange
    const repo = freshRepo();
    await claimCellSlot(repo, 'dev-box');

    // Act
    const second = await claimCellSlot(repo, 'dev-box');
    await releaseCellSlot(repo, 'dev-box');
    const third = await claimCellSlot(repo, 'dev-box');

    // Assert
    expect(second).toBe(false);
    expect(third).toBe(true);
  });
});
