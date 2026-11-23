import { chmodSync, statSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client';
import { createTempDbPath } from '../support/test-db';

const fileMode = (path: string): number => statSync(path).mode & 0o777;

describe('factory database file', () => {
  it('is readable and writable only by its owner when created', () => {
    // Arrange
    const path = createTempDbPath();

    // Act
    createDb(path);

    // Assert
    expect(fileMode(path)).toBe(0o600);
  });

  it('is tightened to owner-only when an existing looser file is opened', () => {
    // Arrange
    const path = createTempDbPath();
    writeFileSync(path, '');
    chmodSync(path, 0o644);

    // Act
    createDb(path);

    // Assert
    expect(fileMode(path)).toBe(0o600);
  });
});
