import { describe, expect, it } from 'vitest';
import {
  COMPILED_URL_PATTERN,
  cellLogPathOf,
  cellPidNameOf,
  operatorCommandOf,
  serverArgsOf,
  webArgsOf,
} from '../../src/config';

describe('cell files', () => {
  it('keeps log and lock of one cell name together', () => {
    // Arrange
    const name = 'dev-box-2';

    // Act
    const files = [cellLogPathOf(name), cellPidNameOf(name)];

    // Assert
    expect(files).toEqual([
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

  it('quotes a compiled binary path that contains spaces', () => {
    // Arrange
    const runtime = {
      execPath: 'C:\\Program Files\\sf\\sf.exe',
      entry: 'C:\\x\\cli.ts',
    };

    // Act
    const command = operatorCommandOf(runtime);

    // Assert
    expect(command).toBe('"C:\\Program Files\\sf\\sf.exe" operator');
  });

  it('quotes a bundled entry path that contains spaces', () => {
    // Arrange
    const runtime = {
      execPath: '/usr/bin/bun',
      entry: '/home/my user/dist/sf.js',
    };

    // Act
    const command = operatorCommandOf(runtime);

    // Assert
    expect(command).toBe('bun "/home/my user/dist/sf.js" operator');
  });
});

describe('compiled runtime detection', () => {
  it('recognises a Bun compiled binary on Linux', () => {
    // Arrange
    const url = 'file:///$bunfs/root/sf';

    // Act
    const matches = COMPILED_URL_PATTERN.test(url);

    // Assert
    expect(matches).toBe(true);
  });

  it('recognises a Bun compiled binary on Windows', () => {
    // Arrange
    const url = 'file:///B:/~BUN/root/sf.exe/src/config.ts';

    // Act
    const matches = COMPILED_URL_PATTERN.test(url);

    // Assert
    expect(matches).toBe(true);
  });

  it('treats a source checkout as not compiled', () => {
    // Arrange
    const url = 'file:///home/u/repo/apps/hq/src/config.ts';

    // Act
    const matches = COMPILED_URL_PATTERN.test(url);

    // Assert
    expect(matches).toBe(false);
  });
});

describe('server spawn args', () => {
  it('starts the internal server marker in the compiled binary', () => {
    // Arrange
    // Act
    const args = serverArgsOf(true);

    // Assert
    expect(args).toEqual(['__server']);
  });

  it('starts the server entry source in dev', () => {
    // Arrange
    // Act
    const args = serverArgsOf(false);

    // Assert
    expect(args).toEqual([expect.stringMatching(/hq[\\/]src[\\/]index\.ts$/)]);
  });
});

describe('web spawn args', () => {
  it('hands the web entry to the internal web marker in the compiled binary', () => {
    // Arrange
    const entry = '/usr/local/share/sf/web/server/entry.mjs';

    // Act
    const args = webArgsOf(true, entry);

    // Assert
    expect(args).toEqual(['__web', entry]);
  });

  it('runs the web entry directly in dev', () => {
    // Arrange
    const entry = '/repo/apps/web-demo/dist/server/entry.mjs';

    // Act
    const args = webArgsOf(false, entry);

    // Assert
    expect(args).toEqual([entry]);
  });
});
