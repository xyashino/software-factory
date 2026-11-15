import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { commitShaSchema, type ProjectId } from '@repo/factory-core/ids';
import type {
  BranchLog,
  GitMirror,
  MirroredProject,
  TodoFile,
} from '@repo/factory-core/ports/git-mirror';
import { runProcess, runProcessBytes } from './run';

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
      if (paths.length === 0) return [];
      // One `cat-file --batch` process reads every blob: one request per line on stdin, one reply each.
      const reply = await runProcessBytes(
        ['git', '--git-dir', dir, 'cat-file', '--batch'],
        { stdin: paths.map((file) => `${commit}:${file}\n`).join('') },
      );
      return batchBlobs(reply, paths);
    },
  };
};

const NEWLINE = 0x0a;

/**
 * Splits the reply of `git cat-file --batch` into one text per path, in order. Each reply is a header
 * line (`<oid> blob <size>`), then `size` bytes of content, then a newline. The size counts bytes, so
 * the content is cut by bytes and decoded afterwards: multibyte text stays whole.
 */
const batchBlobs = (
  reply: Uint8Array,
  paths: readonly string[],
): TodoFile[] => {
  const decoder = new TextDecoder();
  const files: TodoFile[] = [];
  let at = 0;
  for (const file of paths) {
    const end = reply.indexOf(NEWLINE, at);
    if (end === -1) throw new Error(`cat-file --batch: no reply for ${file}`);
    const header = decoder.decode(reply.subarray(at, end));
    const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (!match) {
      throw new Error(`cat-file --batch: ${file} is not a blob (${header})`);
    }
    const start = end + 1;
    const size = Number(match[1]);
    files.push({
      file,
      text: decoder.decode(reply.subarray(start, start + size)),
    });
    at = start + size + 1;
  }
  return files;
};
