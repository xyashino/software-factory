import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claimCellSlot,
  migrateLegacyCellState,
  releaseCellSlot,
} from '../../../../src/adapters/fs/cell-slot';
import { createCellStateFile } from '../../../../src/adapters/fs/cell-state';

const SESSION = { cellId: 'software-factory-dev-box', sessionToken: 'sf_x' };
const LEGACY = '.factory-local/cell.json';

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

describe('legacy cell state migration', () => {
  it('moves the single-cell state into the hostname slot with owner-only permissions', () => {
    // Arrange
    const repo = freshRepo();
    mkdirSync(join(repo, '.factory-local'), { recursive: true });
    writeFileSync(join(repo, LEGACY), `${JSON.stringify(SESSION)}\n`);

    // Act
    const moved = migrateLegacyCellState(repo, 'dev-box');

    // Assert
    const target = join(repo, '.factory-local', 'cells', 'dev-box.json');
    expect(moved).toBe(true);
    expect(existsSync(join(repo, LEGACY))).toBe(false);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('keeps an existing per-cell state untouched', async () => {
    // Arrange
    const repo = freshRepo();
    const store = createCellStateFile(
      join(repo, '.factory-local', 'cells', 'dev-box.json'),
    );
    await store.write(SESSION);
    mkdirSync(join(repo, '.factory-local'), { recursive: true });
    writeFileSync(join(repo, LEGACY), '{"cellId":"old","sessionToken":"old"}');

    // Act
    const moved = migrateLegacyCellState(repo, 'dev-box');

    // Assert
    expect(moved).toBe(false);
    expect(existsSync(join(repo, LEGACY))).toBe(true);
    expect(await store.read()).toEqual(SESSION);
  });

  it('does nothing when no legacy state exists', () => {
    // Arrange
    const repo = freshRepo();

    // Act
    const moved = migrateLegacyCellState(repo, 'dev-box');

    // Assert
    expect(moved).toBe(false);
  });
});
