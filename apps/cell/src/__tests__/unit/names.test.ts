import { describe, expect, it } from 'vitest';
import { branchFor, cycleDirName, paneName, wipRefFor } from '../../names';

describe('names', () => {
  it('names the Work order branch and the WIP ref of a failed Cycle', () => {
    expect(branchFor('add-login')).toBe('factory/add-login');
    expect(wipRefFor('add-login', '01JX')).toBe('factory-wip/add-login/01JX');
  });

  it('gives a pane a name Herdr accepts: lowercase, with a digest, at most 32 characters', () => {
    const name = paneName('Build Station!', 2, '01J0000000000000000000000C');
    expect(name).toMatch(/^build-station_[0-9a-f]{6}_2$/);
    expect(name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  });

  it('keeps distinct names for the same station and attempt in different Cells', () => {
    const cellA = paneName('plan', 1, '01J0000000000000000000000A');
    const cellB = paneName('plan', 1, '01J0000000000000000000000B');
    expect(cellA).not.toBe(cellB);
    expect(cellA).toBe(paneName('plan', 1, '01J0000000000000000000000A'));
  });

  it('shortens a long station name with a digest, still within 32 characters', () => {
    const name = paneName(
      'a-very-long-station-name-that-keeps-going-and-going',
      12,
      '01J0000000000000000000000C',
    );
    expect(name.length).toBeLessThanOrEqual(32);
    expect(name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
    expect(name).toMatch(/_[0-9a-f]{6}_12$/);
  });

  it('prefixes a station name that does not start with a letter', () => {
    const name = paneName('1-build', 1, '01J0000000000000000000000C');
    expect(name).toMatch(/^s1-build_[0-9a-f]{6}_1$/);
  });

  it('names a Cycle directory by a short digest, not the full ULID', () => {
    const dir = cycleDirName('01J0000000000000000000000C');
    expect(dir).toHaveLength(12);
    expect(dir).toBe(cycleDirName('01J0000000000000000000000C'));
  });
});
