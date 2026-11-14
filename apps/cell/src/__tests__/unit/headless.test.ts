import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnHeadless } from '../../runners/headless';
import { observeHeadless } from '../../cycle/observe';

/** The test process's environment, with the unset entries dropped. */
const envOf = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const scratchDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'headless-'));
  dirs.push(dir);
  return dir;
};

describe('headless runner', () => {
  it('runs the command, types text into its input, and records its output in the log', async () => {
    const dir = scratchDir();
    const stdoutPath = join(dir, 'stdout.log');
    const proc = spawnHeadless({
      command: ['cat'],
      cwd: dir,
      env: envOf(),
      stdoutPath,
      stderrPath: join(dir, 'stderr.log'),
    });

    expect(proc.alive()).toBe(true);
    proc.type('focus on the form');
    await waitUntil(() =>
      readFileSync(stdoutPath, 'utf8').includes('focus on the form'),
    );
    proc.stop();

    expect(await proc.exit).not.toBeUndefined();
    expect(proc.alive()).toBe(false);
  });

  it('is gone once it has exited', async () => {
    const dir = scratchDir();
    const proc = spawnHeadless({
      command: ['true'],
      cwd: dir,
      env: envOf(),
      stdoutPath: join(dir, 'out'),
      stderrPath: join(dir, 'err'),
    });
    await proc.exit;

    expect(observeHeadless(proc, join(dir, 'out'), 0).operator).toBe('gone');
  });

  it('reads a running process as working, with its last output time', async () => {
    const dir = scratchDir();
    const stdoutPath = join(dir, 'out');
    const proc = spawnHeadless({
      command: ['cat'],
      cwd: dir,
      env: envOf(),
      stdoutPath,
      stderrPath: join(dir, 'err'),
    });
    try {
      const observed = observeHeadless(proc, stdoutPath, 1);
      expect(observed.operator).toBe('working');
      expect(observed.lastOutputAt).toBeGreaterThanOrEqual(1);
    } finally {
      proc.stop();
      await proc.exit;
    }
  });
});

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition never held');
};
