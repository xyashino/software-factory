import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitPort } from '../../ports/git.port';

interface GitOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

const AUTHOR_FALLBACK: Record<string, string> = {
  GIT_AUTHOR_NAME: 'Software Factory',
  GIT_AUTHOR_EMAIL: 'software-factory@localhost',
  GIT_COMMITTER_NAME: 'Software Factory',
  GIT_COMMITTER_EMAIL: 'software-factory@localhost',
};

const git = async (
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
): Promise<GitOutcome> => {
  const child = Bun.spawn(['git', ...args], {
    cwd: options.cwd,
    env: { ...AUTHOR_FALLBACK, ...process.env, ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

const gitOk = async (
  args: string[],
  options: { cwd: string; env?: Record<string, string> },
): Promise<string> => {
  const outcome = await git(args, options);
  if (outcome.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed in ${options.cwd}: ${outcome.stderr || outcome.stdout}`,
    );
  }
  return outcome.stdout;
};

export const SNAPSHOT_NAMESPACE = 'refs/software-factory/';

const remoteHasBranch = async (
  repoRoot: string,
  branch: string,
): Promise<boolean> => {
  const out = await gitOk(['ls-remote', '--heads', 'origin', branch], {
    cwd: repoRoot,
  });
  return out.length > 0;
};

const withWorktreeTree = async <T>(
  worktree: string,
  use: (tree: string, head: string | undefined) => Promise<T>,
): Promise<T> => {
  const indexDir = mkdtempSync(join(tmpdir(), 'sf-index-'));
  const env = { GIT_INDEX_FILE: join(indexDir, 'index') };
  try {
    const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd: worktree,
    });
    if (head.code === 0) {
      await gitOk(['read-tree', 'HEAD'], { cwd: worktree, env });
    }
    await gitOk(['add', '-A'], { cwd: worktree, env });
    const tree = await gitOk(['write-tree'], { cwd: worktree, env });
    return await use(tree, head.code === 0 ? head.stdout : undefined);
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }
};

export const createGitAdapter = (repoRoot: string): GitPort => {
  return {
    async createWorktree({ path, branch, base }) {
      if (base.startsWith('origin/')) {
        await gitOk(
          ['fetch', '--quiet', 'origin', base.slice('origin/'.length)],
          {
            cwd: repoRoot,
          },
        );
      }
      const branchExists =
        (
          await git(
            ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
            {
              cwd: repoRoot,
            },
          )
        ).code === 0;
      if (branchExists) {
        await gitOk(['worktree', 'add', path, branch], { cwd: repoRoot });
        return;
      }
      if (await remoteHasBranch(repoRoot, branch)) {
        await gitOk(['fetch', '--quiet', 'origin', branch], { cwd: repoRoot });
        await gitOk(
          ['worktree', 'add', '-b', branch, path, `origin/${branch}`],
          { cwd: repoRoot },
        );
        return;
      }
      await gitOk(['worktree', 'add', '-b', branch, path, base], {
        cwd: repoRoot,
      });
    },

    async removeWorktree(path) {
      await git(['worktree', 'remove', '--force', path], { cwd: repoRoot });
    },

    async snapshot({ worktree, ref }) {
      if (!ref.startsWith(SNAPSHOT_NAMESPACE)) {
        throw new Error(`snapshot ref must start with ${SNAPSHOT_NAMESPACE}`);
      }
      return withWorktreeTree(worktree, async (tree, head) => {
        const parents = head === undefined ? [] : ['-p', head];
        const commit = await gitOk(
          ['commit-tree', tree, ...parents, '-m', `snapshot ${ref}`],
          { cwd: worktree },
        );
        await gitOk(['update-ref', ref, commit], { cwd: worktree });
        return commit;
      });
    },

    async differsFromSnapshot({ worktree, ref }) {
      const snapshotTree = await gitOk(
        ['rev-parse', '--verify', `${ref}^{tree}`],
        { cwd: worktree },
      );
      return withWorktreeTree(worktree, async (tree) => tree !== snapshotTree);
    },

    async restore({ worktree, ref }) {
      const commit = await gitOk(['rev-parse', '--verify', `${ref}^{commit}`], {
        cwd: worktree,
      });
      await gitOk(['read-tree', '-u', '--reset', commit], { cwd: worktree });
      await gitOk(['clean', '-fd'], { cwd: worktree });
    },

    async hasChanges({ worktree, base }) {
      const status = await gitOk(['status', '--porcelain'], { cwd: worktree });
      if (status.length > 0) return true;
      const ahead = await gitOk(['rev-list', '--count', `${base}..HEAD`], {
        cwd: worktree,
      });
      return Number(ahead) > 0;
    },

    async commitAll({ worktree, message }) {
      await gitOk(['add', '-A'], { cwd: worktree });
      await gitOk(['commit', '--quiet', '-m', message], { cwd: worktree });
      return gitOk(['rev-parse', 'HEAD'], { cwd: worktree });
    },

    async push({ worktree, branch }) {
      await gitOk(
        ['push', '--quiet', '-u', 'origin', `HEAD:refs/heads/${branch}`],
        { cwd: worktree },
      );
    },

    async remoteBranchExists(branch) {
      return remoteHasBranch(repoRoot, branch);
    },

    async uncommittedFiles(worktree) {
      const tracked = await gitOk(['diff', '--name-only', 'HEAD'], {
        cwd: worktree,
      });
      const untracked = await gitOk(
        ['ls-files', '--others', '--exclude-standard'],
        { cwd: worktree },
      );
      return [...tracked.split('\n'), ...untracked.split('\n')].filter(
        (line) => line.length > 0,
      );
    },

    async removeFile({ worktree, path }) {
      await git(['rm', '-q', '-f', '--ignore-unmatch', '--', path], {
        cwd: worktree,
      });
      rmSync(join(worktree, path), { force: true });
    },

    async addedFiles({ worktree, base }) {
      const out = await gitOk(
        ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`],
        { cwd: worktree },
      );
      return out.split('\n').filter((line) => line.length > 0);
    },

    async headSha(worktree) {
      return gitOk(['rev-parse', 'HEAD'], { cwd: worktree });
    },

    async deleteSnapshotRefs(taskId) {
      const prefix = `${SNAPSHOT_NAMESPACE}${taskId}/`;
      const out = await gitOk(['for-each-ref', '--format=%(refname)', prefix], {
        cwd: repoRoot,
      });
      for (const ref of out.split('\n').filter((line) => line.length > 0)) {
        await gitOk(['update-ref', '-d', ref], { cwd: repoRoot });
      }
    },
  };
};
