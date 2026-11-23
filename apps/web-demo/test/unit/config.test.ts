import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/lib/config';

const REQUIRED_ENV = {
  HQ_PROJECT_ID: 'project-1',
  HQ_DATA_DIR: '/data',
};
const REMOTE_ENV = {
  HQ_PROJECT_ID: 'project-1',
  HQ_URL: 'https://hq.example.com',
};

describe('loadConfig', () => {
  it('fails naming HQ_PROJECT_ID when it is missing', () => {
    // Arrange
    const env = {};

    // Act
    const load = () => loadConfig(env);

    // Assert
    expect(load).toThrow(/HQ_PROJECT_ID/);
  });

  it('listens on 127.0.0.1:4321 and reaches HQ at 127.0.0.1:7070 by default', () => {
    // Arrange
    const env = REQUIRED_ENV;

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.PORT).toBe(4321);
    expect(config.HQ_URL).toBe('http://127.0.0.1:7070');
  });

  it('fails naming HQ_TOKEN when a remote HQ_URL has no token', () => {
    // Arrange
    const env = REMOTE_ENV;

    // Act
    const load = () => loadConfig(env);

    // Assert
    expect(load).toThrow(/HQ_TOKEN/);
  });

  it('accepts a remote HQ_URL when HQ_TOKEN is set', () => {
    // Arrange
    const env = { ...REMOTE_ENV, HQ_TOKEN: 'manual-token' };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.HQ_TOKEN).toBe('manual-token');
  });

  it('reads the join secret from XDG_DATA_HOME/sf on loopback by default', () => {
    // Arrange
    const env = {
      HQ_PROJECT_ID: 'project-1',
      XDG_DATA_HOME: '/xdg',
    };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.HQ_DATA_DIR).toBe(join('/xdg', 'sf'));
  });

  it('falls back to ~/.local/share/sf without XDG_DATA_HOME', () => {
    // Arrange
    const env = { HQ_PROJECT_ID: 'project-1' };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.HQ_DATA_DIR).toBe(join(homedir(), '.local', 'share', 'sf'));
  });

  it('reads the old FACTORY_* names when the HQ_* ones are unset', () => {
    // Arrange
    const env = {
      FACTORY_PROJECT_ID: 'project-1',
      FACTORY_URL: 'https://hq.example.com',
      FACTORY_TOKEN: 'legacy-token',
    };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.HQ_PROJECT_ID).toBe('project-1');
    expect(config.HQ_URL).toBe('https://hq.example.com');
    expect(config.HQ_TOKEN).toBe('legacy-token');
  });

  it('lets HQ_URL win over a stale FACTORY_URL', () => {
    // Arrange
    const env = {
      HQ_PROJECT_ID: 'project-1',
      HQ_URL: 'http://127.0.0.1:8080',
      FACTORY_URL: 'https://old.example.com',
      HQ_DATA_DIR: '/data',
    };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.HQ_URL).toBe('http://127.0.0.1:8080');
  });
});
