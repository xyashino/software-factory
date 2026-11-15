import { createHash } from 'node:crypto';
import {
  gitCommand,
  runShell,
  succeeded,
  textOf,
  type ShellContext,
  type ShellRun,
} from './shell';

/** A key-file pattern with a wildcard names a set of paths; one without names exactly one file. */
const WILDCARD = /[*?]/;

/**
 * A key-file glob as a regex over repo paths: a double star matches any depth (a double star followed by a slash
 * also matches zero directories), a single star one path segment, a question mark one character. Every other
 * character is literal. No other glob syntax exists.
 */
export const globToRegExp = (glob: string): RegExp => {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += (char ?? '').replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
};

/** A file tracked by a commit: its repo path and its git blob hash. */
export interface TrackedFile {
  path: string;
  blob: string;
}

/**
 * The tracked files of `git ls-tree -r -z` output. Each entry is `<mode> <type> <blob>\t<path>`, NUL-terminated,
 * so a path with any character comes through unquoted.
 */
export const parseLsTree = (text: string): TrackedFile[] =>
  text.split('\0').flatMap((entry) => {
    const tab = entry.indexOf('\t');
    if (tab < 0) return [];
    const blob = entry.slice(0, tab).split(' ')[2];
    return blob === undefined ? [] : [{ path: entry.slice(tab + 1), blob }];
  });

/**
 * The key lines of a commit for a set of key files: `path blob` per file a pattern names. A literal names its file
 * (`path -` when the commit does not track it, so adding the file changes the key); a glob names every match.
 * Sorted, one line per path: the same blobs always give the same lines.
 */
export const keyLinesOf = (
  files: readonly TrackedFile[],
  keyFiles: readonly string[],
): string[] => {
  const lines = new Map<string, string>();
  for (const pattern of keyFiles) {
    if (WILDCARD.test(pattern)) {
      const matches = globToRegExp(pattern);
      for (const file of files) {
        if (matches.test(file.path)) {
          lines.set(file.path, `${file.path} ${file.blob}`);
        }
      }
    } else {
      const file = files.find((tracked) => tracked.path === pattern);
      lines.set(pattern, `${pattern} ${file?.blob ?? '-'}`);
    }
  }
  return [...lines.values()].sort();
};

/** The cache key of key lines: a sha256 hex of their text. The same lines always give the same key. */
export const keyDigestOf = (lines: readonly string[]): string =>
  createHash('sha256').update(lines.join('\n')).digest('hex');

/**
 * The tracked files of a commit, read from git's object store. The worktree is not read: it may be dirty from an
 * earlier Job, and only the commit decides which files a changeover depends on.
 */
export const trackedFilesOf = async (
  ctx: ShellContext,
  input: { worktree: string; commit: string; timeoutMs: number },
): Promise<
  { ok: true; files: TrackedFile[] } | { ok: false; run: ShellRun }
> => {
  const run = await runShell(ctx, {
    command: gitCommand(['ls-tree', '-r', '-z', input.commit]),
    cwd: input.worktree,
    timeoutMs: input.timeoutMs,
  });
  if (!succeeded(run)) return { ok: false, run };
  return { ok: true, files: parseLsTree(textOf(run)) };
};
