import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The software-factory package root: src/ -> package. */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * `.factory-local/`: the main checkout's gitignored runtime state and machine-local overrides. `.factory/`
 * holds only the committed repository definitions.
 */
export const localDir = (root: string): string => {
  return join(root, '.factory-local');
};

/** The SQLite event store, inside the main checkout's `.factory-local/`. */
export const storePath = (root: string): string => {
  return join(localDir(root), 'software-factory.sqlite');
};

/** Exclusive lock held by the one running `sf run` supervisor. */
export const supervisorLockPath = (root: string): string => {
  return join(localDir(root), 'supervisor.lock');
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
