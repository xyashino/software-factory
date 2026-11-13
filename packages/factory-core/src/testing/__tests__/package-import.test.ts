import { describe, expect, it } from 'vitest';
// Resolved through the package's own exports, the way another workspace package imports it.
import { given, lineBuilder } from '@repo/factory-core/testing';

describe('the testing subpath', () => {
  it('resolves given and the line builder by package name', () => {
    const line = lineBuilder().operator('plan').build();

    expect(line.stations).toHaveLength(1);
    expect(typeof given).toBe('function');
  });
});
