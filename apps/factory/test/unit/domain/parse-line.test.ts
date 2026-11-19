import { describe, expect, it } from 'vitest';
import { parseLine, toWireSnapshot } from '../../../src/domain/line/parse-line';

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
      exec: [],
      inputs: [],
      runner: 'claude',
      profile: null,
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

  it('takes a station runner from its operator pool', () => {
    // Arrange
    const text = [
      'name: feature',
      'operators:',
      '  planner:',
      '    runner: claude',
      'stations:',
      '  - id: plan',
      '    kind: operator',
      '    operator: planner',
      '',
    ].join('\n');

    // Act
    const line = parseLine(text);

    // Assert
    expect(line.stations[0]).toMatchObject({
      stationId: 'plan',
      runner: 'claude',
    });
  });

  it('ends the line with a deliver station and sends stations by id', () => {
    // Arrange
    const text = [
      'name: feature',
      'operators:',
      '  planner:',
      '    runner: claude',
      'stations:',
      '  - id: plan',
      '    kind: operator',
      '    operator: planner',
      'deliver:',
      '  to: new-pr',
      '',
    ].join('\n');

    // Act
    const wire = toWireSnapshot(parseLine(text));

    // Assert
    expect(wire).toEqual({
      name: 'feature',
      stations: [
        {
          id: 'plan',
          kind: 'operator',
          requiredFiles: [],
          maxAttempts: 1,
        },
        {
          id: 'deliver',
          kind: 'deliver',
          requiredFiles: [],
          maxAttempts: 1,
        },
      ],
    });
  });

  it('refuses a line without stations', () => {
    // Arrange & Act
    const attempt = () => parseLine('name: empty\nstations: []\n');

    // Assert
    expect(attempt).toThrow();
  });
});
