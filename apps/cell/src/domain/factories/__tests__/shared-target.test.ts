import { describe, expect, it } from 'vitest';
import { parseSharedConfig, resolveSharedTarget } from '../shared-target';

const SHARED = {
  current: 'home',
  targets: {
    home: { url: 'http://127.0.0.1:7070', token: 'sf_supervisor_home' },
    office: { url: 'http://10.0.0.5:7070', token: 'sf_supervisor_office' },
  },
};

describe('shared connection target', () => {
  it('resolves the active target from the shared config', () => {
    // Arrange
    const config = parseSharedConfig(SHARED);

    // Act
    const target = resolveSharedTarget(config);

    // Assert
    expect(target).toEqual({
      name: 'home',
      url: 'http://127.0.0.1:7070',
      token: 'sf_supervisor_home',
    });
  });

  it('prefers the requested target over the active one', () => {
    // Arrange
    const config = parseSharedConfig(SHARED);

    // Act
    const target = resolveSharedTarget(config, 'office');

    // Assert
    expect(target?.url).toBe('http://10.0.0.5:7070');
  });

  it('resolves nothing when no target is active', () => {
    // Arrange
    const config = parseSharedConfig({ ...SHARED, current: null });

    // Act
    const target = resolveSharedTarget(config);

    // Assert
    expect(target).toBeNull();
  });

  it('refuses a config without the current key', () => {
    // Arrange
    const raw = { targets: SHARED.targets };

    // Act
    const parse = () => parseSharedConfig(raw);

    // Assert
    expect(parse).toThrow();
  });

  it('refuses a requested target the config does not know', () => {
    // Arrange
    const config = parseSharedConfig(SHARED);

    // Act
    const resolve = () => resolveSharedTarget(config, 'missing');

    // Assert
    expect(resolve).toThrow('shared config has no target named missing');
  });
});
