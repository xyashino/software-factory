import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const SF_BUILD = join(ROOT, 'apps/sf/dist/sf');
const WEB_BUILD = join(ROOT, 'apps/web-demo/dist/server/entry.mjs');
const WEB_DEPS = join(ROOT, 'apps/web-demo/dist/sf-deps/node_modules');
const INSTALL_SCRIPT = join(ROOT, 'scripts/install.mjs');
const built = [SF_BUILD, WEB_BUILD, WEB_DEPS].every((path) => existsSync(path));

const install = (args: readonly string[]) =>
  spawnSync(process.execPath, [INSTALL_SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
  });

describe.skipIf(!built)('install script into a prefix', () => {
  let base = '';
  let prefix = '';

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'sf-install-'));
    prefix = join(base, 'prefix');
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('installs the binary and the web runtime', () => {
    // Arrange
    // Act
    const result = install(['--prefix', prefix]);

    // Assert
    expect(result.status).toBe(0);
    expect(existsSync(join(prefix, 'bin', 'sf'))).toBe(true);
    expect(
      existsSync(join(prefix, 'share', 'sf', 'web', 'server', 'entry.mjs')),
    ).toBe(true);
    expect(existsSync(join(prefix, 'share', 'sf', 'web', 'node_modules'))).toBe(
      true,
    );
  });
});

describe('install script without a built binary', () => {
  it('fails with a hint to build first', () => {
    // Arrange
    const empty = join(mkdtempSync(join(tmpdir(), 'sf-empty-')), 'dist');
    mkdirSync(empty, { recursive: true });

    // Act
    const result = install([
      '--prefix',
      join(empty, 'prefix'),
      '--source',
      empty,
    ]);

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('run bun run build:sf first');
    rmSync(join(empty, '..'), { recursive: true, force: true });
  });
});
