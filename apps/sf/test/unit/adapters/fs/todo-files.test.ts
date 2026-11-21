import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTodoFiles } from '../../../../src/adapters/fs/todo-files';

const sandbox = (): string => mkdtempSync(join(tmpdir(), 'factory-todos-'));

describe('todo files', () => {
  it('lists only markdown files in name order', async () => {
    // Arrange
    const dir = sandbox();
    writeFileSync(join(dir, 'b.md'), 'B');
    writeFileSync(join(dir, 'a.md'), 'A');
    writeFileSync(join(dir, 'notes.txt'), 'skip');

    // Act
    const files = await createTodoFiles().list(dir);

    // Assert
    expect(files).toEqual([
      { filename: 'a.md', text: 'A' },
      { filename: 'b.md', text: 'B' },
    ]);
  });

  it('refuses to overwrite an existing file without force', async () => {
    // Arrange
    const dir = sandbox();
    writeFileSync(join(dir, 'a.md'), 'keep me');

    // Act
    const outcome = await createTodoFiles().write(dir, 'a.md', 'new', false);

    // Assert
    expect(outcome).toBe('refused');
    expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('keep me');
  });

  it('overwrites an existing file with force', async () => {
    // Arrange
    const dir = sandbox();
    writeFileSync(join(dir, 'a.md'), 'old');

    // Act
    const outcome = await createTodoFiles().write(dir, 'a.md', 'new', true);

    // Assert
    expect(outcome).toBe('written');
    expect(readFileSync(join(dir, 'a.md'), 'utf8')).toBe('new');
  });
});
