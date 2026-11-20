import { describe, expect, it } from 'vitest';
import { validateFactoryUrl } from '../factory-target';

describe('factory url validation', () => {
  it('accepts an absolute http url', () => {
    expect(validateFactoryUrl('http://127.0.0.1:7070')).toBe(
      'http://127.0.0.1:7070',
    );
  });

  it('rejects a relative path', () => {
    expect(() => validateFactoryUrl('/api/v1')).toThrow(RangeError);
  });
});
