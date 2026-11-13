import { createHash } from 'node:crypto';

/**
 * The Herdr agent name of an attempt. Unique per task, step and attempt number.
 * Conforms to Herdr's regex: ^[a-z][a-z0-9_-]{0,31}$ (at most 32 chars).
 */
export const agentName = (
  taskId: string,
  stepId: string,
  n: number,
): string => {
  let cleanTask = taskId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleanTask || !/^[a-z]/.test(cleanTask)) {
    cleanTask = `a${cleanTask}`;
  }
  const cleanStep =
    stepId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/^-+|-+$/g, '') || 'step';
  const suffix = `_${cleanStep}_${n}`;
  const maxTaskLen = 32 - suffix.length;
  if (cleanTask.length <= maxTaskLen) {
    return `${cleanTask}${suffix}`;
  }
  const hash = createHash('sha256').update(taskId).digest('hex').slice(0, 6);
  const prefixLen = Math.max(1, maxTaskLen - 7);
  const prefix = cleanTask.slice(0, prefixLen).replace(/-+$/, '');
  return `${prefix}_${hash}${suffix}`;
};

/** The Herdr tab label of an attempt, shown on the board. */
export const tabLabel = (stepId: string, n: number): string => {
  return `${stepId}#${n}`;
};

/** The snapshot ref an attempt records before it runs. */
export const snapshotRefFor = (
  taskId: string,
  stepId: string,
  attemptId: string,
): string => {
  return `refs/software-factory/${taskId}/${stepId}/${attemptId}`;
};

/** The task branch, created off the base ref. */
export const branchFor = (taskId: string): string => {
  return `factory/${taskId}`;
};
