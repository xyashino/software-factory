import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainPaint } from '../../paint';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const freshColorPaint = async () => {
  vi.resetModules();
  return (await import('../../paint')).colorPaint;
};

describe('colorPaint', () => {
  it('emits colour codes without a TTY when NO_COLOR is unset', async () => {
    vi.stubEnv('NO_COLOR', '');

    const colorPaint = await freshColorPaint();

    expect(colorPaint.green('x')).toContain('\u001b[32m');
  });

  it('stays plain when NO_COLOR is set', async () => {
    vi.stubEnv('NO_COLOR', '1');

    const colorPaint = await freshColorPaint();

    expect(colorPaint.green('x')).toBe('x');
  });
});

describe('plainPaint', () => {
  it('returns its input unchanged for every style', () => {
    for (const style of Object.values(plainPaint)) {
      expect(style('x')).toBe('x');
    }
  });
});
