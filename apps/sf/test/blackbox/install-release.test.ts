import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const INSTALL_RELEASE = fileURLToPath(
  new URL('../../../../scripts/install-release.sh', import.meta.url),
);
const ASSET_BIN = 'sf-linux-x64';
const ASSET_WEB = 'sf-web-linux-x64.tar.gz';

const sha256 = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const fakeUname = (dir: string, system: string, machine: string) => {
  mkdirSync(dir, { recursive: true });
  const shim = join(dir, 'uname');
  writeFileSync(
    shim,
    `#!/bin/sh\ncase "$1" in -s) echo ${system} ;; *) echo ${machine} ;; esac\n`,
  );
  chmodSync(shim, 0o755);
  return `${dir}:${process.env.PATH ?? ''}`;
};

const publishRelease = (dir: string) => {
  const stage = join(dir, 'stage');
  mkdirSync(join(stage, 'web', 'server'), { recursive: true });
  writeFileSync(join(stage, 'web', 'server', 'entry.mjs'), 'export {};\n');
  spawnSync('tar', ['-czf', join(dir, ASSET_WEB), '-C', stage, 'web']);
  rmSync(stage, { recursive: true, force: true });

  writeFileSync(join(dir, ASSET_BIN), '#!/bin/sh\necho "sf 0.0.0"\n');
  chmodSync(join(dir, ASSET_BIN), 0o755);
  writeFileSync(
    join(dir, 'SHA256SUMS'),
    [
      `${sha256(join(dir, ASSET_BIN))}  ${ASSET_BIN}`,
      `${sha256(join(dir, ASSET_WEB))}  ${ASSET_WEB}`,
    ].join('\n') + '\n',
  );
  return pathToFileURL(dir).href;
};

const runInstaller = (env: Record<string, string>) =>
  spawnSync('sh', [INSTALL_RELEASE], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });

describe.skipIf(process.platform === 'win32')('install release', () => {
  let base = '';

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'sf-install-release-'));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('installs sf and web ui from release', () => {
    // Arrange
    const releaseUrl = publishRelease(join(base, 'ok'));
    const prefix = join(base, 'ok-prefix');
    const PATH = fakeUname(join(base, 'ok-shim'), 'Linux', 'x86_64');

    // Act
    const result = runInstaller({
      PATH,
      PREFIX: prefix,
      SF_RELEASE_BASE_URL: releaseUrl,
    });

    // Assert
    expect(result.status).toBe(0);
    expect(existsSync(join(prefix, 'bin', 'sf'))).toBe(true);
    expect(
      existsSync(join(prefix, 'share', 'sf', 'web', 'server', 'entry.mjs')),
    ).toBe(true);
  });

  it('aborts on checksum mismatch without touching prefix', () => {
    // Arrange
    const dir = join(base, 'bad');
    const releaseUrl = publishRelease(dir);
    writeFileSync(join(dir, ASSET_BIN), 'tampered after checksums\n');
    const prefix = join(base, 'bad-prefix');
    const PATH = fakeUname(join(base, 'bad-shim'), 'Linux', 'x86_64');

    // Act
    const result = runInstaller({
      PATH,
      PREFIX: prefix,
      SF_RELEASE_BASE_URL: releaseUrl,
    });

    // Assert
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('checksum mismatch');
    expect(existsSync(prefix)).toBe(false);
  });

  it('aborts on unsupported platform', () => {
    // Arrange
    const PATH = fakeUname(join(base, 'bsd-shim'), 'FreeBSD', 'amd64');
    const prefix = join(base, 'bsd-prefix');

    // Act
    const result = runInstaller({
      PATH,
      PREFIX: prefix,
      SF_RELEASE_BASE_URL: pathToFileURL(base).href,
    });

    // Assert
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unsupported platform');
    expect(existsSync(prefix)).toBe(false);
  });
});
