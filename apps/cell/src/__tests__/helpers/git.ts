import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit } from '../../git';

/** A scratch directory that no other test shares. */
export const scratch = (label: string): string =>
  mkdtempSync(join(tmpdir(), `factory-cell-${label}-`));

const must = async (cwd: string, args: string[]): Promise<string> => {
  const result = await runGit(cwd, args);
  if (result.code !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};

/**
 * A bare remote with one commit on `main`: the target repository a Cell pushes to. Returns its path
 * and the base commit sha.
 */
export const makeRemote = async (
  dir: string,
): Promise<{ remote: string; base: string }> => {
  const seed = join(dir, 'seed');
  mkdirSync(seed, { recursive: true });
  await must(seed, ['init', '--quiet', '-b', 'main']);
  writeFileSync(join(seed, 'README.md'), '# fixture\n');
  await must(seed, ['add', '.']);
  await must(seed, ['commit', '--quiet', '-m', 'base']);
  const remote = join(dir, 'remote.git');
  await must(dir, ['clone', '--quiet', '--bare', seed, remote]);
  return { remote, base: await must(remote, ['rev-parse', 'refs/heads/main']) };
};

/** A worktree of a clone of the remote, on the Work order's branch at the base. */
export const makeWorktree = async (
  dir: string,
  remote: string,
  base: string,
  branch: string,
): Promise<string> => {
  const worktree = join(dir, 'worktree');
  await must(dir, ['clone', '--quiet', remote, worktree]);
  await must(worktree, ['checkout', '--quiet', '-B', branch, base]);
  mkdirSync(join(worktree, '.cell'), { recursive: true });
  writeFileSync(join(worktree, '.git', 'info', 'exclude'), '.cell/\n');
  return worktree;
};

/** The subject, body and tree of a commit on a ref of the remote. */
export const commitOf = async (
  remote: string,
  ref: string,
): Promise<{ subject: string; body: string; sha: string }> => {
  const sha = await must(remote, ['rev-parse', ref]);
  const subject = await must(remote, ['log', '-1', '--format=%s', sha]);
  const body = await must(remote, ['log', '-1', '--format=%B', sha]);
  return { subject, body, sha };
};

export { must };
