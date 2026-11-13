import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from '../definitions/frontmatter';
import { colorPaint, type Paint } from '../paint';
import { storePath, supervisorLockPath } from '../paths';
import { acquireSupervisorLock, type SupervisorLock } from '../supervisor/lock';
import { resolveRoot } from '../supervisor/wire';

const SQLITE_FILE_SUFFIXES = ['', '-wal', '-shm'] as const;
const DELIVERED_STATUS_PATTERN = /^\s*status\s*:\s*(delivered|done)\b/;
const INCOMPLETE_STATUS_PATTERN =
  /^\s*status\s*:\s*(parked|blocked|running|failed)\b/;

export interface ResetOptions {
  hard?: boolean;
  todos?: boolean;
  force?: boolean;
  paint?: Paint;
  root?: string;
}

export interface ResetResult {
  dbCleared: boolean;
  logCleared: boolean;
  worktreesRemoved: boolean;
  evidencesRemoved: boolean;
  snapshotRefsDeleted: boolean;
  todosResetCount: number;
  todosDeletedCount: number;
}

const pruneGitWorktrees = (root: string): void => {
  try {
    execFileSync('git', ['worktree', 'prune'], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    // cosmetic when git is not available or not a git repository
  }
};

const deleteSnapshotRefs = (root: string): boolean => {
  try {
    const out = execFileSync(
      'git',
      ['for-each-ref', '--format=%(refname)', 'refs/software-factory/'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const refs = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    for (const ref of refs) {
      try {
        execFileSync('git', ['update-ref', '-d', ref], {
          cwd: root,
          stdio: 'ignore',
        });
      } catch {
        // ignore single ref deletion failure
      }
    }
    return refs.length > 0;
  } catch {
    return false;
  }
};

const clearSqliteStore = (root: string): boolean => {
  const baseStore = storePath(root);
  let cleared = false;
  for (const suffix of SQLITE_FILE_SUFFIXES) {
    const filePath = `${baseStore}${suffix}`;
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
      cleared = true;
    }
  }
  return cleared;
};

const clearSupervisorLog = (root: string): boolean => {
  const logFile = join(root, '.factory', 'supervisor.log');
  if (existsSync(logFile)) {
    rmSync(logFile, { force: true });
    return true;
  }
  return false;
};

const removeWorktrees = (root: string): boolean => {
  const dir = join(root, '.worktrees');
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    pruneGitWorktrees(root);
    return true;
  }
  pruneGitWorktrees(root);
  return false;
};

const removeEvidences = (root: string): boolean => {
  const dir = join(root, '.evidences');
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    return true;
  }
  return false;
};

export const cleanTodos = (
  todosDir: string,
): {
  resetCount: number;
  deletedCount: number;
} => {
  if (!existsSync(todosDir)) return { resetCount: 0, deletedCount: 0 };
  let resetCount = 0;
  let deletedCount = 0;

  for (const name of readdirSync(todosDir)) {
    if (!name.endsWith('.md')) continue;
    const filePath = join(todosDir, name);
    try {
      const content = readFileSync(filePath, 'utf8');
      const parts = splitFrontmatter(content);
      if (parts === null) continue;

      let isDelivered = false;
      let hasStatus = false;
      const lines = parts.frontmatter.split('\n').map((line) => {
        if (/^\s*status\s*:/.test(line)) {
          hasStatus = true;
          if (DELIVERED_STATUS_PATTERN.test(line)) {
            isDelivered = true;
            return line;
          }
          if (INCOMPLETE_STATUS_PATTERN.test(line)) {
            return 'status: todo';
          }
          return line;
        }
        return line;
      });

      if (isDelivered) {
        rmSync(filePath, { force: true });
        deletedCount += 1;
        continue;
      }

      if (!hasStatus) {
        lines.unshift('status: todo');
      }

      const updatedFrontmatter = lines.join('\n');
      const newContent = `---\n${updatedFrontmatter}\n---\n${parts.body}`;
      if (newContent !== content) {
        writeFileSync(filePath, newContent, 'utf8');
        resetCount += 1;
      }
    } catch {
      // ignore unreadable/locked file
    }
  }

  return { resetCount, deletedCount };
};

export const resetTodosStatus = (todosDir: string): number => {
  const { resetCount, deletedCount } = cleanTodos(todosDir);
  return resetCount + deletedCount;
};

export const performReset = (
  root: string,
  options: ResetOptions = {},
): ResetResult => {
  const isHard = options.hard !== false;
  const shouldResetTodos = options.todos ?? isHard;

  const dbCleared = clearSqliteStore(root);
  const logCleared = clearSupervisorLog(root);

  let worktreesRemoved = false;
  let evidencesRemoved = false;
  let snapshotRefsDeleted = false;

  if (isHard) {
    worktreesRemoved = removeWorktrees(root);
    evidencesRemoved = removeEvidences(root);
    snapshotRefsDeleted = deleteSnapshotRefs(root);
  }

  const { resetCount, deletedCount } = shouldResetTodos
    ? cleanTodos(join(root, 'todos'))
    : { resetCount: 0, deletedCount: 0 };

  return {
    dbCleared,
    logCleared,
    worktreesRemoved,
    evidencesRemoved,
    snapshotRefsDeleted,
    todosResetCount: resetCount,
    todosDeletedCount: deletedCount,
  };
};

export const runReset = async (
  options: ResetOptions = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> => {
  const root = options.root ?? resolveRoot(process.cwd(), env);
  const paint = options.paint ?? colorPaint;

  let lock: SupervisorLock | undefined;
  if (!options.force) {
    const acquired = acquireSupervisorLock(root);
    if (!acquired.ok) {
      const { holder, path } = acquired.error;
      const msg = holder
        ? `sf reset refused: supervisor is running (pid ${holder.pid} since ${holder.startedAt}). Stop supervisor before reset or use --force.`
        : `sf reset refused: supervisor lock held at ${path}. Use --force to override.`;
      console.error(paint.red(msg));
      process.exitCode = 1;
      return;
    }
    lock = acquired.value;
  } else {
    const lockPath = supervisorLockPath(root);
    if (existsSync(lockPath)) {
      rmSync(lockPath, { force: true });
    }
  }

  try {
    const result = performReset(root, options);
    console.log(paint.green('Software factory reset complete:'));
    console.log(`  • Cleared SQLite store (${storePath(root)}*)`);
    console.log(`  • Cleared supervisor log (.factory/supervisor.log)`);
    if (options.hard !== false) {
      console.log(
        '  • Removed worktrees (.worktrees/) and pruned git worktrees',
      );
      console.log('  • Removed evidences (.evidences/)');
      console.log('  • Cleared git snapshot refs (refs/software-factory/*)');
    }
    if (options.todos !== false) {
      if (result.todosDeletedCount > 0) {
        console.log(
          `  • Removed ${result.todosDeletedCount} delivered todo file(s) from todos/`,
        );
      }
      if (result.todosResetCount > 0) {
        console.log(
          `  • Reset ${result.todosResetCount} parked/blocked todo file(s) in todos/ to status: todo`,
        );
      }
    }
  } finally {
    lock?.release();
  }
};
