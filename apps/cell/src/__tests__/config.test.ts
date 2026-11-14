import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SLOTS, parseConfig, readConfig } from '../config';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-cell-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('cell config', () => {
  it('runs two slots and no projects when the file says nothing', () => {
    const config = parseConfig('');

    expect(config.slots).toBe(DEFAULT_SLOTS);
    expect(config.projects).toEqual([]);
  });

  it('reads slots, projects, runners and capabilities from TOML', () => {
    const config = parseConfig(`
      slots = 3
      projects = ["software-factory"]
      runners = ["claude", "codex"]
      capabilities = ["docker"]
    `);

    expect(config).toMatchObject({
      slots: 3,
      projects: ['software-factory'],
      runners: ['claude', 'codex'],
      capabilities: ['docker'],
    });
  });

  it('refuses an unknown key and names it', () => {
    expect(() => parseConfig('slotz = 2')).toThrow(/slotz/);
  });

  it('refuses a slot count outside 1 to 64', () => {
    expect(() => parseConfig('slots = 0')).toThrow(/slots/);
  });

  it('reads a missing file as the defaults', () => {
    const config = readConfig(join(dir, 'absent.toml'));

    expect(config.slots).toBe(DEFAULT_SLOTS);
  });

  it('reads the file at the given path', () => {
    const path = join(dir, 'config.toml');
    writeFileSync(path, 'slots = 4\n');

    expect(readConfig(path).slots).toBe(4);
  });
});
