import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveSettings, type FileConfig } from '../config';
import { createContext } from '../context';

const settingsWith = (env: NodeJS.ProcessEnv, file: FileConfig = {}) =>
  resolveSettings({
    flags: {},
    env,
    file,
    defaultServerBin: 'factory-server',
  });

describe('remote mode settings', () => {
  it('stays local when no remote server is named', () => {
    expect(settingsWith({}).remoteUrl).toBeUndefined();
  });

  it('takes the server from the environment before the config file', () => {
    const settings = settingsWith(
      { FACTORY_URL: 'http://env.example:7878', FACTORY_TOKEN: 'tok' },
      { remoteUrl: 'http://file.example:7878' },
    );

    expect(settings.remoteUrl).toBe('http://env.example:7878');
    expect(settings.token).toBe('tok');
  });

  it('takes the server from the config file when the environment is silent', () => {
    expect(
      settingsWith({}, { remoteUrl: 'http://file.example:7878' }).remoteUrl,
    ).toBe('http://file.example:7878');
  });

  it('reads the token from the environment only', () => {
    expect(settingsWith({ FACTORY_TOKEN: 'tok' }).token).toBe('tok');
    expect(settingsWith({}).token).toBeUndefined();
  });

  it('refuses remote mode without a token before any call is made', () => {
    expect(() =>
      createContext(
        {},
        {
          FACTORY_URL: 'http://factory.example:7878',
          FACTORY_CONFIG: '/nonexistent/config.json',
        },
      ),
    ).toThrow('FACTORY_TOKEN is needed');
  });

  it('reads and writes no local data directory in remote mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'factory-remote-nocopy-'));
    const dataDir = join(root, 'never-created');
    try {
      const context = createContext(
        {},
        {
          FACTORY_URL: 'http://factory.example:7878',
          FACTORY_TOKEN: 'tok',
          FACTORY_DATA_DIR: dataDir,
          FACTORY_CONFIG: join(root, 'missing.json'),
        },
      );

      expect(context.settings.remoteUrl).toBe('http://factory.example:7878');
      expect(existsSync(dataDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
