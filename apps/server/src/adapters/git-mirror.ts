import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { commitShaSchema, type ProjectId } from '@repo/factory-core/ids';
import type {
  BranchLog,
  GitMirror,
  MirroredProject,
  TodoFile,
} from '@repo/factory-core/ports/git-mirror';
import { runProcess } from './run';

/** A todo file directly under `todos/` (STORAGE §8, ROADMAP M4). */
const TODO_PATH = /^todos\/[^/]+\.md$/;
/** `git log` separators: a commit's sha and body end with these control characters (never in a message). */
const RECORD_SEP = '\u001e';
const FIELD_SEP = '\u001f';

/**
 * The git mirror over `git` (ROADMAP M4): one bare mirror per project under `mirrorsDir`
 * (`<projectId>.git`), cloned on first use and fetched after that. Intake reads the base branch's
 * commit and the todo files at that commit; nothing is checked out.
 */
export const gitMirror = (options: { mirrorsDir: string }): GitMirror => {
  const dirOf = (projectId: ProjectId): string =>
    join(options.mirrorsDir, `${projectId}.git`);

  const git = (dir: string, args: string[]): Promise<string> =>
    runProcess(['git', '--git-dir', dir, ...args]);

  return {
    sync: async (project: MirroredProject) => {
      const dir = dirOf(project.projectId);
      if (await Bun.file(join(dir, 'HEAD')).exists()) {
        await git(dir, [
          'fetch',
          '--prune',
          '--quiet',
          'origin',
          '+refs/heads/*:refs/heads/*',
        ]);
      } else {
        await mkdir(options.mirrorsDir, { recursive: true });
        await runProcess([
          'git',
          'clone',
          '--mirror',
          '--quiet',
          project.repoUrl,
          dir,
        ]);
      }
      const head = await git(dir, [
        'rev-parse',
        '--verify',
        `refs/heads/${project.baseBranch}^{commit}`,
      ]);
      return commitShaSchema.parse(head.trim());
    },

    branches: async (projectId, prefix): Promise<BranchLog[]> => {
      const dir = dirOf(projectId);
      const refs = await git(dir, [
        'for-each-ref',
        '--format=%(refname)',
        `refs/heads/${prefix}`,
      ]);
      const logs: BranchLog[] = [];
      for (const ref of refs.split('\n').filter((line) => line !== '')) {
        const log = await git(dir, [
          'log',
          `--format=%H${RECORD_SEP}%B${FIELD_SEP}`,
          ref,
        ]);
        logs.push({
          branch: ref.replace(/^refs\/heads\//, ''),
          commits: log
            .split(FIELD_SEP)
            .map((record) => record.trim())
            .filter((record) => record !== '')
            .map((record) => {
              const [sha = '', message = ''] = record.split(RECORD_SEP);
              return {
                sha: commitShaSchema.parse(sha.trim()),
                message: message.trim(),
              };
            }),
        });
      }
      return logs;
    },

    todoFiles: async (projectId, commit): Promise<TodoFile[]> => {
      const dir = dirOf(projectId);
      const listed = await git(dir, [
        'ls-tree',
        '-r',
        '--name-only',
        commit,
        '--',
        'todos',
      ]);
      const paths = listed.split('\n').filter((path) => TODO_PATH.test(path));
      const files: TodoFile[] = [];
      for (const file of paths) {
        files.push({
          file,
          text: await git(dir, ['cat-file', 'blob', `${commit}:${file}`]),
        });
      }
      return files;
    },
  };
};
