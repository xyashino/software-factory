import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One git call in the worktree: its text output, or `ok: false` when git refused it. */
export type GitRun = (
  args: readonly string[],
) => Promise<{ ok: true; text: string } | { ok: false }>;

/**
 * A deterministic fingerprint of the worktree's uncommitted state, `.cell/` excluded: the porcelain status,
 * the diff against HEAD, and the content of every untracked file. Two equal fingerprints mean nothing in the
 * tree changed between them, so a read-only station or an Inspection that ran on a dirty worktree is judged by
 * what it changed, not by what the earlier stations left behind (PROTOCOL §8.3). Undefined when git fails.
 */
export const worktreeFingerprint = async (
  worktree: string,
  git: GitRun,
): Promise<string | undefined> => {
  const exclude = [':(exclude).cell'];
  const status = await git([
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    '.',
    ...exclude,
  ]);
  if (!status.ok) return undefined;
  const diff = await git(['diff', '--binary', 'HEAD', '--', '.', ...exclude]);
  if (!diff.ok) return undefined;

  const hash = createHash('sha256');
  hash.update(status.text);
  hash.update('\0');
  hash.update(diff.text);
  for (const line of status.text.split('\n')) {
    if (!line.startsWith('?? ')) continue;
    const path = line.slice(3);
    hash.update('\0untracked:');
    hash.update(path);
    try {
      hash.update(readFileSync(join(worktree, path)));
    } catch {
      hash.update('\0unreadable');
    }
  }
  return hash.digest('hex');
};

/** Whether the worktree changed between two fingerprints. An unknown fingerprint counts as changed. */
export const changedSince = (
  before: string | undefined,
  after: string | undefined,
): boolean => before === undefined || after === undefined || before !== after;
