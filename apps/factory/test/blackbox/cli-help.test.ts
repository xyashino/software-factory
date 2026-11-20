import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

describe('sf entrypoint', () => {
  it('prints root help naming sf and exits zero', () => {
    // Arrange
    const args = [CLI_PATH, '--help'];

    // Act
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Software factory CLI');
    expect(result.stdout).toContain('sf');
  });

  it('prints root usage when run with no arguments', () => {
    // Arrange
    const args = [CLI_PATH];

    // Act
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Software factory CLI');
    expect(result.stdout).toContain('sf');
    expect(result.stderr).not.toContain('E_NO_COMMAND');
  });
});
