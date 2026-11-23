import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GitPort } from '../../application/ports/git.port';
import type { ProcessPort } from '../../application/ports/process.port';
import { addInfoExclude } from './exclude';

const GIT = 'git';
const REMOTE = 'origin';

export const createGitAdapter = (process: ProcessPort): GitPort => {
  const git = async (args: string[], cwd: string): Promise<string> => {
    const result = await process.run(GIT, args, cwd);
    if (result.exitCode !== 0) {
      throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
  };
  const hasOrigin = async (cwd: string): Promise<boolean> =>
    (await process.run(GIT, ['remote', 'get-url', REMOTE], cwd)).exitCode === 0;
  const fetchOrigin = async (cwd: string): Promise<void> => {
    const result = await process.run(GIT, ['fetch', REMOTE], cwd);
    if (result.exitCode !== 0) {
      throw new Error(`git fetch ${REMOTE} failed: ${result.stderr.trim()}`);
    }
  };
  return {
    currentBranch: async (cwd) =>
      (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim(),
    isClean: async (cwd) => (await git(['status', '--porcelain'], cwd)) === '',
    worktreeAdd: async (repoRoot, path, branch, baseBranch) => {
      if (await hasOrigin(repoRoot)) {
        await fetchOrigin(repoRoot);
      }
      await git(['worktree', 'add', path, '-b', branch, baseBranch], repoRoot);
    },
    worktreeRemove: async (repoRoot, path) => {
      await git(['worktree', 'remove', '--force', path], repoRoot);
    },
    excludeLocally: async (worktree, pattern) => {
      await addInfoExclude(process, worktree, pattern);
    },
    // `--no-verify`: the Line's quality gate runs the hooks' checks (`ci:verify`) itself.
    commit: async (cwd, paths, message) => {
      await git(['add', '--', ...paths], cwd);
      await git(['commit', '--no-verify', '-m', message, '--', ...paths], cwd);
    },
    push: async (cwd, branch) => {
      await git(['push', '--no-verify', '--set-upstream', REMOTE, branch], cwd);
    },
    headSha: async (cwd) => (await git(['rev-parse', 'HEAD'], cwd)).trim(),
    status: (cwd) => git(['status', '--porcelain'], cwd),
    clone: async (url, dest) => {
      await mkdir(dirname(dest), { recursive: true });
      await git(['clone', url, dest], dirname(dest));
    },
    originUrl: async (cwd) => {
      const result = await process.run(GIT, ['remote', 'get-url', REMOTE], cwd);
      return result.exitCode === 0 ? result.stdout.trim() : null;
    },
    // Never `-x`: ignored `.cell/` files must survive a discard.
    resetHard: async (cwd, sha) => {
      await git(['reset', '--hard', sha], cwd);
    },
    clean: async (cwd) => {
      await git(['clean', '-fd'], cwd);
    },
    discardChanges: async (cwd) => {
      await git(['reset', '--hard', 'HEAD'], cwd);
      await git(['clean', '-fd'], cwd);
    },
    hasCommit: async (cwd, sha) =>
      (await process.run(GIT, ['cat-file', '-e', `${sha}^{commit}`], cwd))
        .exitCode === 0,
  };
};
