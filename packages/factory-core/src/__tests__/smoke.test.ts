import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../meta';

describe('factory-core smoke', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@repo/factory-core');
  });
});
