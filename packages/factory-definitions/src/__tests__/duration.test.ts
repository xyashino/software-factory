import { describe, expect, it } from 'vitest';
import { parseDuration } from '../duration';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['20m', 1_200_000],
    ['1h', 3_600_000],
    ['120s', 120_000],
  ])('converts %s to %i milliseconds', (input, ms) => {
    expect(parseDuration(input)).toBe(ms);
  });

  it.each([
    '0s',
    '0m',
    '-5m',
    '1.5m',
    '15',
    'm',
    '',
    '10 m',
    '10ms',
    '1d',
    '01m',
    '1H',
  ])('rejects %j', (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});
