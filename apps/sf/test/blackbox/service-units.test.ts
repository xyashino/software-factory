import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT } from '../../src/domain/exit-codes';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const COMMAND_TIMEOUT_MS = 30_000;
const SECRET_MODE = 0o600;
const JOIN_TOKEN = 'join-token-s3cret-value';

interface Sandbox {
  repo: string;
  dataDir: string;
  unitDir: string;
  env: Record<string, string>;
}

const sandboxes: string[] = [];

const createSandbox = (extraEnv: Record<string, string> = {}): Sandbox => {
  const home = mkdtempSync(join(tmpdir(), 'sf-service-'));
  sandboxes.push(home);
  const repo = join(home, 'repo');
  const configHome = join(home, 'config');
  const dataDir = join(home, 'data');
  mkdirSync(repo, { recursive: true });
  return {
    repo,
    dataDir,
    unitDir: join(configHome, 'systemd', 'user'),
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_CONFIG_HOME: configHome,
      FACTORY_DATA_DIR: dataDir,
      FACTORY_DB_PATH: join(home, 'factory.db'),
      ...extraEnv,
    },
  };
};

const runService = (sandbox: Sandbox, args: readonly string[]) =>
  spawnSync(process.execPath, [CLI_PATH, 'service', ...args], {
    cwd: sandbox.repo,
    env: sandbox.env,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });

const unitOf = (sandbox: Sandbox, name: string): string =>
  readFileSync(join(sandbox.unitDir, name), 'utf8');

afterAll(() => {
  for (const home of sandboxes) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'linux')('sf service units', () => {
  it('writes server and cell units that restart on failure', () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = runService(sandbox, ['install', '--cell', 'edge']);

    // Assert
    expect(result.status).toBe(EXIT.ok);
    const server = unitOf(sandbox, 'sf-server.service');
    const cell = unitOf(sandbox, 'sf-cell-edge.service');
    expect(server).toContain('Restart=on-failure');
    expect(server).toContain('WantedBy=default.target');
    expect(cell).toContain('Restart=on-failure');
    expect(cell).toContain('cell start --name edge');
    expect(cell).toContain(`WorkingDirectory=${sandbox.repo}`);
  });

  it('writes HQ_* names into the server unit even when given FACTORY_* ones', () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = runService(sandbox, ['install', '--cell', 'edge']);

    // Assert
    expect(result.status).toBe(EXIT.ok);
    const server = unitOf(sandbox, 'sf-server.service');
    expect(server).toContain(`Environment=HQ_DATA_DIR=${sandbox.dataDir}`);
    expect(server).toContain('Environment=HQ_PORT=7070');
    expect(server).not.toContain('FACTORY_');
  });

  it('prints the systemctl and linger commands without running them', () => {
    // Arrange
    const sandbox = createSandbox();

    // Act
    const result = runService(sandbox, ['install', '--cell', 'edge']);

    // Assert
    expect(result.stdout).toContain(
      'systemctl --user enable --now sf-server.service sf-cell-edge.service',
    );
    expect(result.stdout).toContain('loginctl enable-linger');
  });

  it('keeps the join token out of the unit and in a 0600 env file', () => {
    // Arrange
    const sandbox = createSandbox({ FACTORY_JOIN_TOKEN: JOIN_TOKEN });

    // Act
    const result = runService(sandbox, ['install', '--cell', 'edge']);

    // Assert
    const envFile = join(sandbox.dataDir, 'service', 'sf-cell-edge.env');
    expect(statSync(envFile).mode & 0o777).toBe(SECRET_MODE);
    expect(readFileSync(envFile, 'utf8')).toContain(JOIN_TOKEN);
    expect(unitOf(sandbox, 'sf-cell-edge.service')).not.toContain(JOIN_TOKEN);
    expect(result.stdout).not.toContain(JOIN_TOKEN);
    expect(result.stderr).not.toContain(JOIN_TOKEN);
  });

  it('refuses to overwrite a unit it did not write', () => {
    // Arrange
    const sandbox = createSandbox();
    mkdirSync(sandbox.unitDir, { recursive: true });
    const foreign = join(sandbox.unitDir, 'sf-server.service');
    writeFileSync(foreign, '[Service]\nExecStart=/bin/true\n');

    // Act
    const result = runService(sandbox, ['install']);

    // Assert
    expect(result.status).toBe(EXIT.refused);
    expect(result.stderr).toContain('not written by sf service install');
    expect(readFileSync(foreign, 'utf8')).toBe(
      '[Service]\nExecStart=/bin/true\n',
    );
  });

  it('uninstall removes the units install wrote and keeps foreign ones', () => {
    // Arrange
    const sandbox = createSandbox();
    runService(sandbox, ['install', '--cell', 'edge']);
    const foreign = join(sandbox.unitDir, 'sf-cell-mine.service');
    writeFileSync(foreign, '[Service]\nExecStart=/bin/true\n');

    // Act
    const result = runService(sandbox, ['uninstall']);

    // Assert
    expect(result.status).toBe(EXIT.ok);
    expect(existsSync(join(sandbox.unitDir, 'sf-server.service'))).toBe(false);
    expect(existsSync(join(sandbox.unitDir, 'sf-cell-edge.service'))).toBe(
      false,
    );
    expect(existsSync(foreign)).toBe(true);
  });

  it('uninstall with --cell removes only that Cell unit and its env file', () => {
    // Arrange
    const sandbox = createSandbox({ FACTORY_JOIN_TOKEN: JOIN_TOKEN });
    runService(sandbox, ['install', '--cell', 'edge']);
    runService(sandbox, ['install', '--cell', 'other']);

    // Act
    const result = runService(sandbox, ['uninstall', '--cell', 'edge']);

    // Assert
    expect(result.status).toBe(EXIT.ok);
    expect(existsSync(join(sandbox.unitDir, 'sf-cell-edge.service'))).toBe(
      false,
    );
    expect(
      existsSync(join(sandbox.dataDir, 'service', 'sf-cell-edge.env')),
    ).toBe(false);
    expect(existsSync(join(sandbox.unitDir, 'sf-cell-other.service'))).toBe(
      true,
    );
    expect(existsSync(join(sandbox.unitDir, 'sf-server.service'))).toBe(true);
  });
});
