import { describe, expect, it } from 'vitest';
import {
  allocateSlotNames,
  assertCount,
  nextBackoffMs,
} from '../slot-allocation';

describe('slot name allocation', () => {
  it('names the first slot after the host and the rest with a suffix', () => {
    expect(allocateSlotNames('pc', 3, [])).toEqual(['pc', 'pc-2', 'pc-3']);
  });

  it('skips names already taken in the repository', () => {
    expect(allocateSlotNames('pc', 2, ['pc', 'pc-2'])).toEqual([
      'pc-3',
      'pc-4',
    ]);
  });
});

describe('count guard', () => {
  it('accepts a count within the limit', () => {
    expect(() => assertCount(4, 4)).not.toThrow();
  });

  it('rejects a count above the limit', () => {
    expect(() => assertCount(5, 4)).toThrow(RangeError);
  });

  it('rejects a count below one', () => {
    expect(() => assertCount(0, 4)).toThrow(RangeError);
  });
});

describe('restart backoff', () => {
  it('doubles the delay with each attempt', () => {
    expect([0, 1, 2].map((attempt) => nextBackoffMs(attempt, 1000))).toEqual([
      1000, 2000, 4000,
    ]);
  });

  it('never exceeds the ceiling', () => {
    expect(nextBackoffMs(20, 1000)).toBe(60_000);
  });
});
