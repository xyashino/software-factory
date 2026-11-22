import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  removeFile,
  writeTextFile,
} from '../../../../src/adapters/fs/write-text';

const freshDir = (): string =>
  mkdtempSync(join(tmpdir(), 'factory-write-text-'));

describe('text file writes', () => {
  it('writes the whole text and leaves no staging file behind', async () => {
    // Arrange
    const path = join(freshDir(), 'nested', 'state.json');

    // Act
    await writeTextFile(path, '{"outcome":"complete"}\n');

    // Assert
    expect(readFileSync(path, 'utf8')).toBe('{"outcome":"complete"}\n');
    expect(readdirSync(dirname(path))).toEqual(['state.json']);
  });

  it('replaces an earlier file in one step', async () => {
    // Arrange
    const path = join(freshDir(), 'state.json');
    await writeTextFile(path, 'old');

    // Act
    await writeTextFile(path, 'new');

    // Assert
    expect(readFileSync(path, 'utf8')).toBe('new');
    expect(readdirSync(dirname(path))).toEqual(['state.json']);
  });

  it('keeps the requested file mode', async () => {
    // Arrange
    const path = join(freshDir(), 'runner.json');

    // Act
    await writeTextFile(path, '{}', 0o600);

    // Assert
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('file removal', () => {
  it('removes a file and accepts one that is already gone', async () => {
    // Arrange
    const dir = freshDir();
    const path = join(dir, 'feedback.md');
    await writeTextFile(path, 'verdict');

    // Act
    await removeFile(path);
    await removeFile(path);

    // Assert
    expect(readdirSync(dir)).toEqual([]);
  });
});
