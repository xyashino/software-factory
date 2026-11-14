import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigError,
  configFilePath,
  parseFileConfig,
  readFileConfig,
  resolveSettings,
} from '../config';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SERVER = '/srv/factory-server/main.ts';

describe('config file', () => {
  it('reads the keys it knows and nothing else', () => {
    expect(
      parseFileConfig({
        dataDir: '/data',
        serverBin: '/bin/s.ts',
        color: false,
      }),
    ).toEqual({ dataDir: '/data', serverBin: '/bin/s.ts', color: false });
  });

  it('refuses an unknown key, naming it', () => {
    expect(() => parseFileConfig({ dataDirr: '/data' })).toThrow(
      'unknown config key "dataDirr"',
    );
  });

  it('refuses a value of the wrong type', () => {
    expect(() => parseFileConfig({ color: 'yes' })).toThrow(ConfigError);
    expect(() => parseFileConfig({ dataDir: '' })).toThrow(ConfigError);
  });

  it('treats a missing file as an empty config', () => {
    expect(readFileConfig(join(dir, 'absent.json'))).toEqual({});
  });

  it('reads a file on disk and reports broken JSON as a config error', () => {
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify({ dataDir: '/from-file' }));
    writeFileSync(bad, '{ nope');

    expect(readFileConfig(good)).toEqual({ dataDir: '/from-file' });
    expect(() => readFileConfig(bad)).toThrow('not valid JSON');
  });

  it('finds the file from FACTORY_CONFIG, then from XDG_CONFIG_HOME', () => {
    expect(configFilePath({ FACTORY_CONFIG: '/x/c.json' })).toBe('/x/c.json');
    expect(configFilePath({ XDG_CONFIG_HOME: '/xdg' })).toBe(
      '/xdg/factory/config.json',
    );
  });
});

describe('settings precedence', () => {
  it('prefers a flag over the environment, the file and the default', () => {
    const settings = resolveSettings({
      flags: { dataDir: '/flag' },
      env: { FACTORY_DATA_DIR: '/env' },
      file: { dataDir: '/file' },
      defaultServerBin: SERVER,
    });

    expect(settings.dataDir).toBe('/flag');
  });

  it('prefers the environment over the file', () => {
    const settings = resolveSettings({
      flags: {},
      env: { FACTORY_DATA_DIR: '/env' },
      file: { dataDir: '/file' },
      defaultServerBin: SERVER,
    });

    expect(settings.dataDir).toBe('/env');
  });

  it('uses the file, then the default data directory', () => {
    const fromFile = resolveSettings({
      flags: {},
      env: {},
      file: { dataDir: '/file' },
      defaultServerBin: SERVER,
    });
    const fallback = resolveSettings({
      flags: {},
      env: {},
      file: {},
      defaultServerBin: SERVER,
    });

    expect(fromFile.dataDir).toBe('/file');
    expect(fallback.dataDir.endsWith(join('.local', 'share', 'factory'))).toBe(
      true,
    );
    expect(fallback.serverBin).toBe(SERVER);
  });

  it('turns colour off for --no-color, a set NO_COLOR, or color false in the file', () => {
    const base = {
      flags: {},
      env: {},
      file: {},
      defaultServerBin: SERVER,
    };

    expect(resolveSettings(base).color).toBe(true);
    expect(resolveSettings({ ...base, flags: { noColor: true } }).color).toBe(
      false,
    );
    expect(resolveSettings({ ...base, env: { NO_COLOR: '1' } }).color).toBe(
      false,
    );
    expect(resolveSettings({ ...base, file: { color: false } }).color).toBe(
      false,
    );
  });
});
