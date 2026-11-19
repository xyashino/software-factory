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
  return {
    currentBranch: async (cwd) =>
      (await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim(),
    isClean: async (cwd) => (await git(['status', '--porcelain'], cwd)) === '',
    worktreeAdd: async (repoRoot, path, branch, baseBranch) => {
      await git(['worktree', 'add', path, '-b', branch, baseBranch], repoRoot);
    },
    worktreeRemove: async (repoRoot, path) => {
      await git(['worktree', 'remove', '--force', path], repoRoot);
    },
    excludeLocally: async (worktree, pattern) => {
      await addInfoExclude(process, worktree, pattern);
    },
    commit: async (cwd, paths, message) => {
      await git(['add', '--', ...paths], cwd);
      await git(['commit', '-m', message, '--', ...paths], cwd);
    },
    push: async (cwd, branch) => {
      await git(['push', '--set-upstream', REMOTE, branch], cwd);
    },
    headSha: async (cwd) => (await git(['rev-parse', 'HEAD'], cwd)).trim(),
    status: (cwd) => git(['status', '--porcelain'], cwd),
  };
};
