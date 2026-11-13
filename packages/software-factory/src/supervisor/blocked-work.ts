import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TaskRow } from '../ports/store.port';
import { worktreeDir } from '../paths';
import { notifyQuietly } from './notify';
import type { SupervisorPorts } from './ports';

const errorText = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

/**
 * A blocked task with uncommitted or unpushed work keeps that work on a draft
 * `[BLOCKED]` PR. The worktree stays for inspection. A failure is logged, and the
 * block itself stands.
 */
export const publishBlockedWork = async (
  ports: SupervisorPorts,
  task: TaskRow,
  reason: string,
  detail: string,
): Promise<void> => {
  const worktree = worktreeDir(ports.root, task.id);
  if (!existsSync(worktree)) return;
  let published: string;
  try {
    if (!(await ports.git.hasChanges({ worktree, base: ports.baseRef }))) {
      return;
    }
    const { prUrl } = await ports.deliverer.publishBlocked({
      taskId: task.id,
      worktree,
      branch: task.branch,
      reason,
      detail,
    });
    ports.store.append(task.id, { type: 'delivered_blocked', prUrl });
    published = prUrl;
  } catch (error) {
    const log = join(ports.root, '.evidences', task.id, 'blocked-pr.log');
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, errorText(error));
    return;
  }
  await notifyQuietly(ports, task.id, `Task Blocked: ${task.id}`, {
    body: `PR [BLOCKED]: ${published}`,
    sound: 'request',
  });
};
