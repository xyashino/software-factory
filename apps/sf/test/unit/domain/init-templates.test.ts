import { describe, expect, it } from 'vitest';
import { parseLine } from '../../../src/domain/line/parse-line';
import { parseRepoConfig } from '../../../src/domain/repo-config/parse-repo-config';
import {
  LINE_FAST,
  LINE_FEATURE,
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

  it('writes a feature line that plans, builds, gates and audits', () => {
    // Arrange
    const text = LINE_FEATURE;

    // Act
    const line = parseLine(text);

    // Assert
    expect(line.name).toBe('feature');
    expect(line.stations.map((station) => station.stationId)).toEqual([
      'plan',
      'build',
      'quality-gate',
      'audit',
      'deliver',
    ]);
  });

  it('configures a mechanic on every starter line', () => {
    // Arrange
    const texts = [LINE_STANDARD, LINE_FAST, LINE_FEATURE];

    // Act
    const mechanics = texts.map((text) => parseLine(text).mechanic);

    // Assert
    for (const mechanic of mechanics) {
      expect(mechanic).toEqual({
        profile: 'mechanic',
        runner: 'claude',
        model: 'sonnet',
        timeoutMs: 20 * 60_000,
        headless: false,
        permission: 'read',
      });
    }
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
