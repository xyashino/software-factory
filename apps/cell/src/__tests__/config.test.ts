import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  notificationsEnabled,
  parseConfig,
  readConfig,
  repoCellDataDir,
} from '../config';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-cell-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('notifications config', () => {
  it('is on by default', () => {
    expect(parseConfig('').notifications).toBe(true);
  });

  it('is turned off by the notifications key', () => {
    expect(parseConfig('notifications = false').notifications).toBe(false);
  });

  it('refuses a notifications value that is not a boolean', () => {
    expect(() => parseConfig('notifications = "yes"')).toThrow(/notifications/);
  });

  it('is enabled only for an interactive Cell that is not turned off', () => {
    const interactive = parseConfig('');
    const headless = parseConfig('headless_operators = true');
    const off = parseConfig('notifications = false');

    expect(notificationsEnabled(interactive, {})).toBe(true);
    expect(notificationsEnabled(interactive, { FACTORY_NOTIFY: '0' })).toBe(
      false,
    );
    expect(notificationsEnabled(headless, {})).toBe(false);
    expect(notificationsEnabled(off, {})).toBe(false);
  });
});

describe('repoCellDataDir', () => {
  it('keeps the Cell state under the repository in .factory-local/cell', () => {
    expect(repoCellDataDir('/work/app')).toBe('/work/app/.factory-local/cell');
  });
});

describe('cell config', () => {
  it('runs no projects when the file says nothing', () => {
    const config = parseConfig('');

    expect(config.projects).toEqual([]);
    expect(config).not.toHaveProperty('slots');
  });

  it('reads projects, runners and capabilities from TOML', () => {
    const config = parseConfig(`
      projects = ["software-factory"]
      runners = ["claude", "codex"]
      capabilities = ["docker"]
    `);

    expect(config).toMatchObject({
      projects: ['software-factory'],
      runners: ['claude', 'codex'],
      capabilities: ['docker'],
    });
  });

  it('refuses the removed slots key and names it', () => {
    expect(() => parseConfig('slots = 2')).toThrow(
      /config\.toml: slots: removed/,
    );
  });

  it('refuses an unknown key and names it', () => {
    expect(() => parseConfig('slotz = 2')).toThrow(/slotz/);
  });

  it('reads a missing file as the defaults', () => {
    const config = readConfig(join(dir, 'absent.toml'));

    expect(config.projects).toEqual([]);
  });

  it('reads the file at the given path', () => {
    const path = join(dir, 'config.toml');
    writeFileSync(path, 'projects = ["software-factory"]\n');

    expect(readConfig(path).projects).toEqual(['software-factory']);
  });
});
