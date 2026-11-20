import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/lib/config';

const REQUIRED_ENV = {
  FACTORY_PROJECT_ID: 'project-1',
  FACTORY_DATA_DIR: '/data',
};
const REMOTE_ENV = {
  FACTORY_PROJECT_ID: 'project-1',
  FACTORY_URL: 'https://factory.example.com',
};

describe('loadConfig', () => {
  it('fails naming FACTORY_PROJECT_ID when it is missing', () => {
    // Arrange
    const env = {};

    // Act
    const load = () => loadConfig(env);

    // Assert
    expect(load).toThrow(/FACTORY_PROJECT_ID/);
  });

  it('listens on 127.0.0.1:4321 and reaches factory at 127.0.0.1:7070 by default', () => {
    // Arrange
    const env = REQUIRED_ENV;

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.PORT).toBe(4321);
    expect(config.FACTORY_URL).toBe('http://127.0.0.1:7070');
  });

  it('fails naming FACTORY_TOKEN when a remote FACTORY_URL has no token', () => {
    // Arrange
    const env = REMOTE_ENV;

    // Act
    const load = () => loadConfig(env);

    // Assert
    expect(load).toThrow(/FACTORY_TOKEN/);
  });

  it('accepts a remote FACTORY_URL when FACTORY_TOKEN is set', () => {
    // Arrange
    const env = { ...REMOTE_ENV, FACTORY_TOKEN: 'manual-token' };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.FACTORY_TOKEN).toBe('manual-token');
  });

  it('reads the join secret from XDG_DATA_HOME/sf on loopback by default', () => {
    // Arrange
    const env = {
      FACTORY_PROJECT_ID: 'project-1',
      XDG_DATA_HOME: '/xdg',
    };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.FACTORY_DATA_DIR).toBe(join('/xdg', 'sf'));
  });

  it('falls back to ~/.local/share/sf without XDG_DATA_HOME', () => {
    // Arrange
    const env = { FACTORY_PROJECT_ID: 'project-1' };

    // Act
    const config = loadConfig(env);

    // Assert
    expect(config.FACTORY_DATA_DIR).toBe(
      join(homedir(), '.local', 'share', 'sf'),
    );
  });
});
