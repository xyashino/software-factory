import { describe, expect, it } from 'vitest';
import { parseLine } from '../../../src/domain/line/parse-line';
import { parseRepoConfig } from '../../../src/domain/repo-config/parse-repo-config';
import {
  LINE_FAST,
  LINE_STANDARD,
  repoConfigText,
} from '../../../src/domain/init/templates';

describe('init starter templates', () => {
  it('writes a standard line the line parser accepts', () => {
    // Arrange
    const text = LINE_STANDARD;

    // Act
    const line = parseLine(text);

    // Assert
    expect(line.name).toBe('standard');
    expect(line.stations.map((station) => station.stationId)).toEqual([
      'build',
      'quality-gate',
      'audit',
      'deliver',
    ]);
  });

  it('writes a fast line that delivers without an audit', () => {
    // Arrange
    const text = LINE_FAST;

    // Act
    const line = parseLine(text);

    // Assert
    expect(line.name).toBe('fast');
    expect(line.stations.map((station) => station.stationId)).toEqual([
      'build',
      'quality-gate',
      'deliver',
    ]);
  });

  it('writes a repo config the repo config parser accepts', () => {
    // Arrange
    const text = repoConfigText('acme-widgets');

    // Act
    const config = parseRepoConfig(text);

    // Assert
    expect(config.project).toBe('acme-widgets');
  });
});
