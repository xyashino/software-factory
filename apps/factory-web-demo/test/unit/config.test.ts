import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/lib/config';

const REQUIRED_ENV = { FACTORY_PROJECT_ID: 'project-1' };

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
});
