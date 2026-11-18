import { describe, expect, it } from 'vitest';
import { exitCodeFor, lineFor, type Result } from '../exit-codes';

describe('exit codes', () => {
  it.each<[string, Result, number]>([
    ['ok', { kind: 'ok' }, 0],
    ['refused', { kind: 'refused', code: 'invalid', message: 'bad' }, 1],
    ['argument error', { kind: 'argument_error', message: 'no file' }, 2],
    ['unreachable', { kind: 'unreachable', message: 'down' }, 3],
  ])('exits %s with code %i', (_name, result, code) => {
    expect(exitCodeFor(result)).toBe(code);
  });

  it('prints ok true on success', () => {
    expect(lineFor({ kind: 'ok' })).toBe('ok: true');
  });

  it('prints code and message on refusal', () => {
    const line = lineFor({
      kind: 'refused',
      code: 'stale_epoch',
      message: 'epoch moved on',
    });

    expect(line).toBe('stale_epoch: epoch moved on');
  });

  it('prints only the message on argument error', () => {
    expect(lineFor({ kind: 'argument_error', message: 'no file' })).toBe(
      'no file',
    );
  });
});
