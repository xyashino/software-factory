import { describe, expect, it } from 'vitest';
import { newCommandId } from '../client/command-id';

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('command id', () => {
  it('is a 26-character ULID', () => {
    expect(newCommandId()).toMatch(CROCKFORD);
  });

  it('starts with the time it was made, so ids sort by time', () => {
    const early = newCommandId(() => 1_000);
    const late = newCommandId(() => 2_000);

    expect(early.slice(0, 10) < late.slice(0, 10)).toBe(true);
  });

  it('differs from one invocation to the next', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCommandId()));

    expect(ids.size).toBe(50);
  });
});
