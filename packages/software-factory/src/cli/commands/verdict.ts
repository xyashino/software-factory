import { defineCommand } from 'citty';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CallerError, type Caller } from '../caller';
import { nonEmptyFile } from '../../supervisor/util';
import { colorPaint } from '../../paint';

export type VerdictDecision = 'pass' | 'fail';

/**
 * Records a judge's decision. `fail` needs a non-empty feedback file; `pass`
 * may carry one. Only judging roles may call this.
 */
export const runVerdict = (
  caller: Caller,
  decision: VerdictDecision,
  feedback?: string,
): { feedbackPath: string | undefined } => {
  if (!caller.role.verdict) {
    throw new CallerError(
      `role "${caller.role.id}" does not judge; finish with \`sf done\``,
    );
  }
  const feedbackPath =
    caller.attempt.artifacts.feedback ??
    join(caller.evidenceDir, 'feedback.md');
  // A read-only judge cannot write the file itself: it hands the text over here.
  if (feedback !== undefined && feedback.trim().length > 0) {
    mkdirSync(dirname(feedbackPath), { recursive: true });
    writeFileSync(feedbackPath, feedback);
  }
  const hasFeedback = nonEmptyFile(feedbackPath);

  if (decision === 'fail' && !hasFeedback) {
    throw new CallerError(
      `verdict fail needs a non-empty feedback file at ${feedbackPath}`,
    );
  }
  const recorded = hasFeedback ? feedbackPath : undefined;
  caller.store.append(caller.taskId, {
    type: 'verdict',
    attemptId: caller.attemptId,
    pass: decision === 'pass',
    ...(recorded === undefined ? {} : { feedbackPath: recorded }),
  });
  return { feedbackPath: recorded };
};

export const verdictCommand = defineCommand({
  meta: {
    name: 'verdict',
    description: 'Record a judge decision: pass or fail',
  },
  args: {
    decision: {
      type: 'positional',
      required: true,
      description: 'pass or fail',
    },
    feedback: {
      type: 'string',
      description:
        'Feedback text, or "-" to read it from stdin; written to the feedback file',
    },
  },
  run: async ({ args }) => {
    const decision = args.decision;
    if (decision !== 'pass' && decision !== 'fail') {
      console.error(`${colorPaint.red('sf:')} verdict takes "pass" or "fail"`);
      process.exitCode = 1;
      return;
    }
    const feedback =
      args.feedback === '-' ? await Bun.stdin.text() : args.feedback;
    const { withCaller } = await import('../in-pane');
    await withCaller((caller) => {
      runVerdict(caller, decision, feedback);
      console.log(
        colorPaint.green(
          `verdict: ${decision} recorded for ${caller.attemptId}`,
        ),
      );
    });
  },
});
