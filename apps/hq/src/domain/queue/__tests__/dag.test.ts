import { describe, expect, it } from 'vitest';
import { findDependencyCycle } from '../dag';

describe('dependency cycle detection', () => {
  it('finds no cycle when every chain ends at a root task', () => {
    const parents = new Map<string, string | null>([
      ['pay-api', 'pay-schema'],
      ['pay-schema', null],
    ]);

    expect(findDependencyCycle(parents)).toBeNull();
  });

  it('finds the task that closes a two task cycle', () => {
    const parents = new Map<string, string | null>([
      ['pay-api', 'pay-schema'],
      ['pay-schema', 'pay-api'],
    ]);

    expect(findDependencyCycle(parents)).toBe('pay-api');
  });

  it('finds a task that depends on itself', () => {
    const parents = new Map<string, string | null>([['pay-api', 'pay-api']]);

    expect(findDependencyCycle(parents)).toBe('pay-api');
  });

  it('finds a cycle reached from a task outside of it', () => {
    const parents = new Map<string, string | null>([
      ['pay-docs', 'pay-api'],
      ['pay-api', 'pay-schema'],
      ['pay-schema', 'pay-api'],
    ]);

    expect(findDependencyCycle(parents)).toBe('pay-api');
  });
});
