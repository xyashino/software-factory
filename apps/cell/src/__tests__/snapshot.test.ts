import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  changedSince,
  worktreeFingerprint,
  type GitRun,
} from '../workspace/snapshot';
import { makeRepo } from '../testing/git-repo';

/** Git in a worktree, as the fingerprint reads it: its output, or `ok: false` on a refusal. */
const gitIn =
  (cwd: string): GitRun =>
  async (args) => {
    try {
      const text = execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return { ok: true, text };
    } catch {
      return { ok: false };
    }
  };

let root: string;
let worktree: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-snapshot-'));
  worktree = join(root, 'worktree');
  makeRepo(worktree, { 'README.md': '# repo\n', 'src/app.ts': 'export {};\n' });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fingerprint = () => worktreeFingerprint(worktree, gitIn(worktree));

describe('worktreeFingerprint (the read-only check, PROTOCOL §8.3)', () => {
  it('is the same on an unchanged dirty tree, so earlier Stations work does not count as a change', async () => {
    writeFileSync(join(worktree, 'src/app.ts'), 'export const app = 1;\n');
    writeFileSync(join(worktree, 'new.txt'), 'built\n');

    const before = await fingerprint();
    const after = await fingerprint();

    expect(before).toBeDefined();
    expect(after).toBe(before);
    expect(changedSince(before, after)).toBe(false);
  });

  it('changes when a file already modified is modified again', async () => {
    writeFileSync(join(worktree, 'src/app.ts'), 'export const app = 1;\n');
    const before = await fingerprint();

    writeFileSync(join(worktree, 'src/app.ts'), 'export const app = 2;\n');

    expect(changedSince(before, await fingerprint())).toBe(true);
  });

  it('changes when an untracked file is rewritten with the same name', async () => {
    writeFileSync(join(worktree, 'new.txt'), 'built\n');
    const before = await fingerprint();

    writeFileSync(join(worktree, 'new.txt'), 'built twice\n');

    expect(changedSince(before, await fingerprint())).toBe(true);
  });

  it('changes when a new file appears', async () => {
    const before = await fingerprint();

    writeFileSync(join(worktree, 'added.txt'), 'x\n');

    expect(changedSince(before, await fingerprint())).toBe(true);
  });

  it('ignores .cell/, where the Cell writes prompts, logs and outputs', async () => {
    const before = await fingerprint();

    mkdirSync(join(worktree, '.cell', 'cycles'), { recursive: true });
    writeFileSync(join(worktree, '.cell', 'cycles', 'prompt.md'), 'prompt\n');
    writeFileSync(join(worktree, '.cell', 'outputs.txt'), 'out\n');

    expect(changedSince(before, await fingerprint())).toBe(false);
  });
});

describe('changedSince', () => {
  it('counts an unknown fingerprint as changed, the way a failed git status always failed', () => {
    expect(changedSince(undefined, 'abc')).toBe(true);
    expect(changedSince('abc', undefined)).toBe(true);
    expect(changedSince(undefined, undefined)).toBe(true);
  });

  it('is false only for two equal known fingerprints', () => {
    expect(changedSince('abc', 'abc')).toBe(false);
    expect(changedSince('abc', 'abd')).toBe(true);
  });
});
