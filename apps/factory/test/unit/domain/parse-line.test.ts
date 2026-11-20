import { describe, expect, it } from 'vitest';
import { parseLine, wireSnapshotOf } from '../../../src/domain/line/parse-line';

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
const REPO_LINE = [
  'name: fast',
  'workspace:',
  '  setup:',
  '    exec: [pnpm install]',
  'operators:',
  '  builder:',
  '    profile: builder',
  '    runner: claude',
  '    model: sonnet',
  '    timeout: 40m',
  '    headless: false',
  '  doctor:',
  '    profile: doctor',
  '    runner: antigravity',
  '    permission: read',
  'stations:',
  '  - id: build',
  '    kind: operator',
  '    operator: builder',
  '  - id: quality-gate',
  '    kind: inspection',
  '    exec: [pnpm ci:verify]',
  '    onFail:',
  '      retry: build',
  '      max: 3',
  '  - id: audit',
  '    kind: operator',
  '    operator: doctor',
  '    inputs: [build.commit]',
  'deliver:',
  '  to: new-pr',
  '  requireAdr: true',
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
      profile: null,
      model: null,
      exec: [],
      inputs: [],
      headless: true,
      permission: 'write',
      timeoutMs: null,
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

  it('takes the runner, model and profile from the station operator', () => {
    // Arrange & Act
    const line = parseLine(REPO_LINE);

    // Assert
    expect(line.stations[0]).toMatchObject({
      runner: 'claude',
      model: 'sonnet',
      profile: 'builder',
    });
    expect(line.stations[1]?.exec).toEqual(['pnpm ci:verify']);
    expect(line.setup).toEqual(['pnpm install']);
  });

  it('ends with a deliver station when the line declares delivery', () => {
    // Arrange & Act
    const line = parseLine(REPO_LINE);

    // Assert
    expect(line.stations.map((station) => station.kind)).toEqual([
      'operator',
      'inspection',
      'operator',
      'deliver',
    ]);
  });

  it('sends the server only the station fields it stores', () => {
    // Arrange
    const line = parseLine(REPO_LINE);

    // Act
    const wire = wireSnapshotOf(line);

    // Assert
    expect(wire.stations).toEqual([
      { id: 'build', kind: 'operator', requiredFiles: [], maxAttempts: 1 },
      {
        id: 'quality-gate',
        kind: 'inspection',
        requiredFiles: [],
        maxAttempts: 3,
        onFailRetryStationId: 'build',
      },
      { id: 'audit', kind: 'operator', requiredFiles: [], maxAttempts: 1 },
      { id: 'deliver', kind: 'deliver', requiredFiles: [], maxAttempts: 1 },
    ]);
  });

  it('reads how each operator runs: pane or headless, permission, timeout', () => {
    // Arrange & Act
    const line = parseLine(REPO_LINE);

    // Assert
    expect(line.stations[0]).toMatchObject({
      headless: false,
      permission: 'write',
      timeoutMs: 40 * 60_000,
    });
    expect(line.stations[2]).toMatchObject({
      runner: 'antigravity',
      headless: true,
      permission: 'read',
      inputs: ['build.commit'],
    });
    expect(line.requireAdr).toBe(true);
  });
});
