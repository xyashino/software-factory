import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adminUsage } from '../usage';

/** The repository root, four levels above this test file. */
const ROOT = new URL('../../../../', import.meta.url);
const read = (path: string): string =>
  readFileSync(new URL(path, ROOT), 'utf8');
const UNITS = [
  'deploy/systemd/factory-server.service',
  'deploy/systemd/factory-cell.service',
];

/** The `ExecStart` value of a unit file: the program name after `/usr/bin/env`. */
const programOf = (unit: string): string => {
  const line = unit.split('\n').find((text) => text.startsWith('ExecStart='));
  const match = /^ExecStart=\/usr\/bin\/env (\S+)/.exec(line ?? '');
  if (!match?.[1])
    throw new Error('a unit has no ExecStart=/usr/bin/env <program>');
  return match[1];
};

/** The `bin` names a workspace package installs. */
const binsOf = (packageJson: string): string[] =>
  Object.keys(
    (JSON.parse(read(packageJson)) as { bin?: Record<string, string> }).bin ??
      {},
  );

describe('deploy units', () => {
  it('start binaries that the packages install', () => {
    const installed = new Set([
      ...binsOf('apps/server/package.json'),
      ...binsOf('apps/cell/package.json'),
    ]);

    for (const unit of UNITS) {
      expect(installed.has(programOf(read(unit)))).toBe(true);
    }
  });

  it('have the sections and the restart policy of the runbook', () => {
    for (const unit of UNITS) {
      const text = read(unit);
      expect(text).toMatch(/^\[Unit\]$/m);
      expect(text).toMatch(/^\[Service\]$/m);
      expect(text).toMatch(/^\[Install\]$/m);
      expect(text).toMatch(/^Restart=on-failure$/m);
      expect(text).toMatch(/^NoNewPrivileges=yes$/m);
    }
  });

  it('give the Cell a stop timeout longer than its leave cap', () => {
    const cell = read('deploy/systemd/factory-cell.service');
    const timeout = /^TimeoutStopSec=(\d+)$/m.exec(cell)?.[1];

    // LEAVE_CAP_MS is 5 minutes (apps/cell/src/leave.ts).
    expect(Number(timeout)).toBeGreaterThan(5 * 60);
  });

  it('pass systemd-analyze verify when systemd-analyze is installed', () => {
    const probe = spawnSync('systemd-analyze', ['--version']);
    if (probe.status !== 0) return;

    const verify = spawnSync(
      'systemd-analyze',
      ['verify', ...UNITS.map((unit) => new URL(unit, ROOT).pathname)],
      { encoding: 'utf8' },
    );

    expect(verify.stderr).not.toMatch(
      /Command .* is not executable|Failed to parse/,
    );
  });
});

describe('runbook', () => {
  const runbook = read('deploy/RESTORE.md');

  it('names only factory-server admin operations that exist', () => {
    const verbs = [...runbook.matchAll(/factory-server admin ([a-z-]+)/g)].map(
      (match) => match[1] ?? '',
    );

    expect(verbs.length).toBeGreaterThan(0);
    for (const verb of verbs) {
      expect(adminUsage).toMatch(new RegExp(`\\b${verb}\\b`));
    }
  });

  it('names only factory admin operations that the CLI prints', () => {
    const cliUsage = read('apps/cli/src/usage.ts');
    const verbs = [...runbook.matchAll(/factory admin ([a-z-]+)/g)].map(
      (match) => match[1] ?? '',
    );

    expect(verbs.length).toBeGreaterThan(0);
    for (const verb of verbs) {
      expect(cliUsage).toContain(`factory admin ${verb}`);
    }
  });

  it('points Litestream at the data directory the unit uses', () => {
    const config = read('deploy/litestream.yml.example');

    expect(config).toContain('path: /var/lib/factory/factory.db');
    expect(config).toMatch(/^\s+sync-interval: /m);
    // Naming the variable in a comment is fine; assigning a value to it in the file is not.
    expect(config).not.toMatch(
      /(secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*\S/i,
    );
    expect(existsSync(new URL('deploy/RESTORE.md', ROOT))).toBe(true);
  });
});
