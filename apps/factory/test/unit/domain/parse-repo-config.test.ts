import { describe, expect, it } from 'vitest';
import { parseRepoConfig } from '../../../src/domain/repo-config/parse-repo-config';

describe('parse repo config', () => {
  it('reads the project id and keeps other keys', () => {
    // Arrange
    const text = JSON.stringify({
      project: 'software-factory',
      rules: './.nitpick/rules',
      herdr: { tabPerRun: true },
    });

    // Act
    const config = parseRepoConfig(text);

    // Assert
    expect(config.project).toBe('software-factory');
    expect(config.rules).toBe('./.nitpick/rules');
  });

  it('refuses a config without a project', () => {
    // Arrange
    const text = JSON.stringify({ rules: './.nitpick/rules' });

    // Act
    const attempt = () => parseRepoConfig(text);

    // Assert
    expect(attempt).toThrow();
  });
});
