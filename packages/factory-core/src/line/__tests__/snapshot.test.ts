import { describe, expect, it } from 'vitest';
import { LINE, makeLine, stationOf } from '../../order/__tests__/builders';
import {
  findStation,
  lineSnapshotSchema,
  stationAt,
  stationIndex,
} from '../snapshot';

describe('line snapshot lookup', () => {
  it('finds a station by its id', () => {
    expect(findStation(LINE, stationOf('build'))?.id).toBe('build');
  });

  it('gives the position of a station in the line', () => {
    expect(stationIndex(LINE, stationOf('audit'))).toBe(2);
  });

  it('gives no position for a station the line does not have', () => {
    expect(stationIndex(LINE, stationOf('deploy'))).toBeUndefined();
  });

  it('gives the station at a position', () => {
    expect(stationAt(LINE, 0)?.id).toBe('plan');
  });

  it('gives no station past the end of the line', () => {
    expect(stationAt(LINE, LINE.stations.length)).toBeUndefined();
  });

  it('gives no station for a negative position', () => {
    expect(stationAt(LINE, -1)).toBeUndefined();
  });

  it('rejects a line with no operator station, since only operators commit work', () => {
    const inspectionOnly = {
      ...LINE,
      stations: [{ ...LINE.stations[3]!, onFail: undefined }],
    };
    expect(lineSnapshotSchema.safeParse(inspectionOnly).success).toBe(false);
  });

  it('rejects a line whose station ids repeat', () => {
    const duplicate = {
      ...LINE,
      stations: [LINE.stations[0]!, LINE.stations[0]!],
    };
    expect(lineSnapshotSchema.safeParse(duplicate).success).toBe(false);
  });

  it('gives a station no declared artifacts when it names none', () => {
    const bare = { ...LINE.stations[1]!, artifacts: undefined };

    const parsed = lineSnapshotSchema.parse({
      ...LINE,
      stations: [bare],
    });

    expect(parsed.stations[0]?.artifacts).toEqual([]);
  });

  it('rejects an inspection command that names a machine-local path', () => {
    const broken = {
      ...LINE,
      stations: [{ ...LINE.stations[3]!, exec: ['cat /home/dev/build.log'] }],
    };

    expect(lineSnapshotSchema.safeParse(broken).success).toBe(false);
  });

  it('accepts a single-station line', () => {
    expect(makeLine([LINE.stations[0]!]).stations).toHaveLength(1);
  });

  it('rejects a line whose onFail names no station', () => {
    const broken = {
      ...LINE,
      stations: [
        { ...LINE.stations[0]!, onFail: { retry: 'nowhere', max: 1 } },
      ],
    };
    expect(lineSnapshotSchema.safeParse(broken).success).toBe(false);
  });
});
