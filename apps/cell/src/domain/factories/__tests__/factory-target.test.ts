import { describe, expect, it } from 'vitest';
import { validateFactoryName, validateFactoryUrl } from '../factory-target';

describe('factory url validation', () => {
  it('accepts an absolute http url', () => {
    expect(validateFactoryUrl('http://127.0.0.1:7070')).toBe(
      'http://127.0.0.1:7070',
    );
  });

  it('accepts an absolute https url', () => {
    expect(validateFactoryUrl('https://factory.example.com')).toBe(
      'https://factory.example.com',
    );
  });

  it('strips the trailing slash', () => {
    expect(validateFactoryUrl('https://factory.example.com/api/')).toBe(
      'https://factory.example.com/api',
    );
  });

  it('rejects a relative path', () => {
    expect(() => validateFactoryUrl('/api/v1')).toThrow(RangeError);
  });

  it('rejects a non-http scheme', () => {
    expect(() => validateFactoryUrl('ftp://factory.example.com')).toThrow(
      'factory url must use http or https',
    );
  });
});

describe('factory name validation', () => {
  it('trims surrounding whitespace', () => {
    expect(validateFactoryName('  vps  ')).toBe('vps');
  });

  it('rejects a blank name', () => {
    expect(() => validateFactoryName('   ')).toThrow(
      'factory name must not be empty',
    );
  });
});
