import { defineCommand } from 'citty';
import { basename } from 'node:path';
import { CallerError, type Caller } from '../caller';
import { nonEmptyFile } from '../../supervisor/util';
import { colorPaint } from '../../paint';

export type DoneOutcome = { ok: true } | { ok: false; missing: string[] };

/**
 * Completes an agent attempt once every declared artifact is written. A judging
 * role must finish with `verdict` instead.
 */
export const runDone = (caller: Caller): DoneOutcome => {
  if (caller.role.verdict) {
    throw new CallerError(
      `role "${caller.role.id}" judges its step; finish with \`sf verdict pass\` or \`verdict fail\``,
    );
  }
  const missing = Object.values(caller.attempt.artifacts)
    .filter((path) => !nonEmptyFile(path))
    .map((path) => basename(path));
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  caller.store.append(caller.taskId, {
    type: 'completed',
    attemptId: caller.attemptId,
  });
  return { ok: true };
};

export const doneCommand = defineCommand({
  meta: {
    name: 'done',
    description: 'Finish the current step once every artifact is written',
  },
  run: async () => {
    const { withCaller } = await import('../in-pane');
    await withCaller((caller) => {
      const outcome = runDone(caller);
      if (outcome.ok) {
        console.log(colorPaint.green(`done: ${caller.attemptId} completed`));
        return;
      }
      console.error(
        `${colorPaint.red('sf:')} missing or empty artifacts: ${outcome.missing.join(', ')}`,
      );
      process.exitCode = 1;
    });
  },
});
