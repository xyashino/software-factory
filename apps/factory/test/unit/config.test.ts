import { describe, expect, it } from 'vitest';
import {
  cellLogPathOf,
  cellPidNameOf,
  cellStatePathOf,
  operatorCommandOf,
} from '../../src/config';

describe('cell files', () => {
  it('keeps state, log and lock of one cell name together', () => {
    // Arrange
    const name = 'dev-box-2';

    // Act
    const files = [
      cellStatePathOf(name),
      cellLogPathOf(name),
      cellPidNameOf(name),
    ];

    // Assert
    expect(files).toEqual([
      '.factory-local/cells/dev-box-2.json',
      '.factory-local/cells/dev-box-2.log',
      'dev-box-2.pid',
    ]);
  });
});

describe('operator command', () => {
  it('runs the compiled sf binary directly', () => {
    // Arrange
    const runtime = { execPath: '/usr/local/bin/sf', entry: '/x/src/cli.ts' };

    // Act
    const command = operatorCommandOf(runtime);

    // Assert
    expect(command).toBe('/usr/local/bin/sf operator');
  });

  it('runs the source entry through bun in dev', () => {
    // Arrange
    const runtime = {
      execPath: '/home/u/.bun/bin/bun',
      entry: '/x/src/cli.ts',
    };

    // Act
    const command = operatorCommandOf(runtime);

    // Assert
    expect(command).toBe('bun /x/src/cli.ts operator');
  });

  it('runs the bundled entry through bun', () => {
    // Arrange
    const runtime = { execPath: '/usr/bin/bun', entry: '/x/dist/sf.js' };

    // Act
    const command = operatorCommandOf(runtime);

    // Assert
    expect(command).toBe('bun /x/dist/sf.js operator');
  });

  it('ends with operator by default', () => {
    // Arrange
    // Act
    const command = operatorCommandOf();

    // Assert
    expect(command.endsWith(' operator')).toBe(true);
  });
});
