import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runShell } from '../../shell';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cell-shell-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the workspace shell', () => {
  it('runs a line in the directory and reports success', async () => {
    const result = await runShell(dir, 'echo ran > marker.txt', 5_000);

    expect(result).toEqual({ ok: true, detail: '' });
    expect(readFileSync(join(dir, 'marker.txt'), 'utf8')).toBe('ran\n');
  });

  it('reports a failing line with its error output', async () => {
    const result = await runShell(dir, 'echo broke >&2; exit 3', 5_000);

    expect(result.ok).toBe(false);
    expect(result.detail).toBe('broke');
  });

  it('reports a line that runs past its timeout as timed out', async () => {
    const result = await runShell(dir, 'sleep 5', 100);

    expect(result).toEqual({ ok: false, detail: 'timed out after 100 ms' });
  });
});
