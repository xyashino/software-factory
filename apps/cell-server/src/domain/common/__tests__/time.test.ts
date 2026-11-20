import { describe, expect, it } from 'vitest';
import { addMs, isExpired } from '../time';

describe('time helpers', () => {
  it('adds a duration to an epoch instant', () => {
    const startedAt = 1_000;

    expect(addMs(startedAt, 60_000)).toBe(61_000);
  });

  it('treats a lease as expired at its exact expiry instant', () => {
    const expiresAt = 61_000;

    expect(isExpired(expiresAt, 61_000)).toBe(true);
  });

  it('keeps a lease alive one millisecond before its expiry', () => {
    const expiresAt = 61_000;

    expect(isExpired(expiresAt, 60_999)).toBe(false);
  });
});
