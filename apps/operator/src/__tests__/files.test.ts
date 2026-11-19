import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readInputFile } from '../files';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'operator-files-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('input files', () => {
  it('reads a UTF-8 file as text', () => {
    const path = join(dir, 'feedback.md');
    writeFileSync(path, 'Zażółć gęślą jaźń\n', 'utf8');

    const result = readInputFile(path);

    expect(result).toEqual({ kind: 'ok', text: 'Zażółć gęślą jaźń\n' });
  });

  it('refuses a missing file as an argument error', () => {
    const result = readInputFile(join(dir, 'missing.md'));

    expect(result.kind).toBe('argument_error');
  });

  it('refuses a directory as an argument error', () => {
    const result = readInputFile(dir);

    expect(result.kind).toBe('argument_error');
  });
});
