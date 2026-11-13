import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The software-factory package root: src/ -> package. */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The SQLite event store, inside the main checkout's `.factory/`. */
export const storePath = (root: string): string => {
  return join(root, '.factory', 'software-factory.sqlite');
};

/** Exclusive lock held by the one running `sf run` supervisor. */
export const supervisorLockPath = (root: string): string => {
  return join(root, '.factory', 'supervisor.lock');
};

/** `.evidences/<taskId>/<attemptId>`: prompts, artifacts, gate logs. */
export const evidenceDir = (
  root: string,
  taskId: string,
  attemptId: string,
): string => {
  return join(root, '.evidences', taskId, attemptId);
};

/** `.evidences/<taskId>/supervisor.log`: live supervisor log for this task. */
export const supervisorLogPath = (root: string, taskId: string): string => {
  return join(root, '.evidences', taskId, 'supervisor.log');
};

/** `.worktrees/<taskId>`: the task's isolated checkout. */
export const worktreeDir = (root: string, taskId: string): string => {
  return join(root, '.worktrees', taskId);
};

/** The package's `bin/` directory, put first on PATH inside agent panes. */
export const PACKAGE_BIN_DIR = join(PACKAGE_ROOT, 'bin');
