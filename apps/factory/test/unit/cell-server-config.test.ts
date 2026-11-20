import { describe, expect, it } from 'vitest';
import { CELL_SERVER_MARKER, cellServerArgsOf } from '../../src/config';

describe('cell server entry', () => {
  it('dispatches through the internal marker in the compiled binary', () => {
    // Arrange
    const compiled = true;

    // Act
    const args = cellServerArgsOf(compiled);

    // Assert
    expect(args).toEqual([CELL_SERVER_MARKER]);
  });

  it('runs the cell server source file directly in dev', () => {
    // Arrange
    const compiled = false;

    // Act
    const args = cellServerArgsOf(compiled);

    // Assert
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/apps\/cell-server\/src\/index\.ts$/);
  });
});
