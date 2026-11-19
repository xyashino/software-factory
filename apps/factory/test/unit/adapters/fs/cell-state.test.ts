import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCellStateFile } from '../../../../src/adapters/fs/cell-state';

const SESSION = {
  cellId: 'software-factory-dev-box',
  sessionToken: 'sf_cell_stub',
};

const freshPath = (): string =>
  join(
    mkdtempSync(join(tmpdir(), 'factory-cell-state-')),
    'nested',
    'cell.json',
  );

describe('cell state file', () => {
  it('stores the session with owner-only permissions', async () => {
    // Arrange
    const path = freshPath();
    const store = createCellStateFile(path);

    // Act
    await store.write(SESSION);

    // Assert
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await store.read()).toEqual(SESSION);
  });

  it('reads nothing before a session is stored', async () => {
    // Arrange
    const store = createCellStateFile(freshPath());

    // Act
    const session = await store.read();

    // Assert
    expect(session).toBeNull();
  });

  it('writes only the session fields to disk', async () => {
    // Arrange
    const path = freshPath();
    const store = createCellStateFile(path);

    // Act
    await store.write(SESSION);

    // Assert
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(SESSION);
  });
});
