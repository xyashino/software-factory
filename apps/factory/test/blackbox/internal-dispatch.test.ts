import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const TOKEN_PATTERN = /^\S{16,}$/;

const dirs: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-internal-'));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('internal server marker', () => {
  it('prints a supervisor token for admin token create', () => {
    // Arrange
    const dbDir = makeDir();
    const env = {
      ...process.env,
      FACTORY_DATA_DIR: dbDir,
      FACTORY_DB_PATH: join(dbDir, 'factory.db'),
    };

    // Act
    const result = spawnSync(
      process.execPath,
      [CLI_PATH, '__server', 'admin', 'token', 'create'],
      { env, encoding: 'utf8', timeout: COMMAND_TIMEOUT_MS },
    );

    // Assert
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(TOKEN_PATTERN);
  });
});
