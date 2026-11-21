import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createConnectionStore } from '../../../../src/adapters/fs/connection-store';
import { Refused } from '../../../../src/application/core/errors';

const tempConfigPath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-config-'));
  return join(dir, 'sf', 'config.json');
};

describe('connection config store', () => {
  it('reads an empty config when no file exists yet', () => {
    // Arrange
    const store = createConnectionStore(tempConfigPath());

    // Act
    const config = store.read();

    // Assert
    expect(config).toEqual({ current: null, targets: {} });
  });

  it('writes the config with owner-only mode and no staging file left behind', () => {
    // Arrange
    const path = tempConfigPath();
    const store = createConnectionStore(path);

    // Act
    store.write({
      current: 'local',
      targets: { local: { url: 'http://127.0.0.1:7070', token: 'sup_1' } },
    });

    // Assert
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(path, '..'))).toEqual(['config.json']);
    expect(store.read().targets.local?.token).toBe('sup_1');
  });

  it('refuses a config file that is not valid JSON', () => {
    // Arrange
    const path = tempConfigPath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{not json');
    const store = createConnectionStore(path);

    // Act
    const attempt = () => store.read();

    // Assert
    expect(attempt).toThrow(Refused);
  });

  it('refuses a config file with an unknown shape', () => {
    // Arrange
    const path = tempConfigPath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ current: 'x', extra: true }));
    const store = createConnectionStore(path);

    // Act
    const attempt = () => store.read();

    // Assert
    expect(attempt).toThrow(Refused);
  });
});
