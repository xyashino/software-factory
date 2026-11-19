import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  prepareRepairDir,
  repairDirOf,
} from '../../../src/adapters/fs/repair-dir';

const baseDir = (): string => mkdtempSync(join(tmpdir(), 'repair-dir-'));

describe('repair dir', () => {
  it('places a job repair dir under the Cell data dir with a short stable name', () => {
    const dir = repairDirOf('/data/cell', 'job-1');

    expect(dir).toMatch(/^\/data\/cell\/repairs\/[0-9a-f]{16}$/);
    expect(repairDirOf('/data/cell', 'job-1')).toBe(dir);
    expect(repairDirOf('/data/cell', 'job-2')).not.toBe(dir);
  });

  it('writes the prompt and an executable factory-operator shim', () => {
    const dir = join(baseDir(), 'repair');

    const prepared = prepareRepairDir(dir, {
      prompt: 'Fix the failing gate.',
      bun: '/usr/bin/bun',
      operatorCli: '/repo/apps/operator-cli/src/cli.ts',
    });

    expect(readFileSync(prepared.promptPath, 'utf8')).toBe(
      'Fix the failing gate.',
    );
    const shim = join(prepared.binDir, 'factory-operator');
    expect(statSync(shim).mode & 0o111).not.toBe(0);
    expect(readFileSync(shim, 'utf8')).toContain(
      "exec '/usr/bin/bun' '/repo/apps/operator-cli/src/cli.ts' \"$@\"",
    );
  });

  it('runs the shim with the arguments it was given', () => {
    const dir = join(baseDir(), 'repair');
    const prepared = prepareRepairDir(dir, {
      prompt: 'p',
      bun: '/bin/echo',
      operatorCli: 'operator-entry',
    });

    const output = execFileSync(join(prepared.binDir, 'factory-operator'), [
      'context',
    ]).toString();

    expect(output.trim()).toBe('operator-entry context');
  });

  it('rewrites the prompt and shim when prepared again', () => {
    const dir = join(baseDir(), 'repair');
    prepareRepairDir(dir, { prompt: 'first', bun: 'a', operatorCli: 'b' });

    const prepared = prepareRepairDir(dir, {
      prompt: 'second',
      bun: 'c',
      operatorCli: 'd',
    });

    expect(readFileSync(prepared.promptPath, 'utf8')).toBe('second');
    expect(
      readFileSync(join(prepared.binDir, 'factory-operator'), 'utf8'),
    ).toContain("exec 'c' 'd'");
  });
});
