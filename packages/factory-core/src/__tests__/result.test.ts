import { describe, expect, it } from 'vitest';
import { andThen, err, isOk, map, ok } from '../result';

describe('result', () => {
  it('wraps a value as ok', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
    expect(isOk(ok(3))).toBe(true);
  });

  it('wraps an error as not ok', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
    expect(isOk(err('boom'))).toBe(false);
  });

  it('maps the value of an ok result', () => {
    expect(map(ok(2), (n) => n * 10)).toEqual({ ok: true, value: 20 });
  });

  it('keeps the error of an error result when mapping', () => {
    expect(map(err('boom'), (n: number) => n * 10)).toEqual({
      ok: false,
      error: 'boom',
    });
  });

  it('chains an ok result into the next step', () => {
    const halve = (n: number) => (n % 2 === 0 ? ok(n / 2) : err('odd'));
    expect(andThen(ok(8), halve)).toEqual({ ok: true, value: 4 });
    expect(andThen(ok(7), halve)).toEqual({ ok: false, error: 'odd' });
  });

  it('stops a chain at the first error', () => {
    const next = () => ok('never');
    expect(andThen(err('first'), next)).toEqual({ ok: false, error: 'first' });
  });
});
