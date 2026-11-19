import { describe, expect, it } from 'vitest';
import { parseLine } from '../../../src/domain/line/parse-line';

const LINE = [
  'name: feature',
  'stations:',
  '  - id: plan',
  '    kind: operator',
  '  - id: build',
  '    kind: operator',
  '    requiredFiles: [report.md, commit.txt]',
  '    runner: claude',
  '    onFail:',
  '      retry: build',
  '      max: 3',
  '',
].join('\n');

describe('line snapshot', () => {
  it('numbers stations and keeps required files', () => {
    // Arrange & Act
    const line = parseLine(LINE);

    // Assert
    expect(line.name).toBe('feature');
    expect(line.stations.map((station) => station.stepIndex)).toEqual([0, 1]);
    expect(line.stations[1]).toEqual({
      stationId: 'build',
      stepIndex: 1,
      kind: 'operator',
      requiredFiles: ['report.md', 'commit.txt'],
      runner: 'claude',
      maxAttempts: 3,
      onFailRetryStationId: 'build',
    });
  });

  it('allows one attempt when a station sets no retry', () => {
    // Arrange & Act
    const line = parseLine(LINE);

    // Assert
    expect(line.stations[0]).toMatchObject({
      maxAttempts: 1,
      onFailRetryStationId: null,
      requiredFiles: [],
    });
  });

  it('refuses a line without stations', () => {
    // Arrange & Act
    const attempt = () => parseLine('name: empty\nstations: []\n');

    // Assert
    expect(attempt).toThrow();
  });
});
