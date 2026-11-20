import { describe, expect, it } from 'vitest';
import { isDesiredState } from '../cell-slot';

describe('desired state guard', () => {
  it('accepts running as a desired state', () => {
    expect(isDesiredState('running')).toBe(true);
  });

  it('accepts stopped as a desired state', () => {
    expect(isDesiredState('stopped')).toBe(true);
  });

  it('rejects a runtime-only status such as failed', () => {
    expect(isDesiredState('failed')).toBe(false);
  });

  it('rejects an unknown state', () => {
    expect(isDesiredState('paused')).toBe(false);
  });
});
