import { randomUUID } from 'node:crypto';
import { defineCommand } from 'citty';
import { reduce } from '../../engine/reduce';
import { CallerError, type Caller } from '../caller';

export type AskTarget = 'operator' | 'human';

/** Records a question and parks the attempt until it is answered. */
export const runAsk = (
  caller: Caller,
  to: string,
  text: string,
): { questionId: string; to: AskTarget } => {
  if (caller.isOperator) {
    throw new CallerError(
      'the operator cannot ask; answer, unblock or escalate instead',
    );
  }
  if (to !== 'operator' && to !== 'human') {
    throw new CallerError('ask takes "operator" or "human" as its target');
  }
  if (text.trim().length === 0) {
    throw new CallerError('the question must not be empty');
  }
  if (to === 'operator' && caller.workflow.operator === undefined) {
    throw new CallerError(
      `workflow "${caller.workflow.name}" has no operator; ask human`,
    );
  }
  const open = reduce(
    caller.workflow,
    caller.store.events(caller.taskId),
  ).openQuestion;
  if (open !== undefined) {
    throw new CallerError(`question ${open.questionId} is still open`);
  }

  const questionId = randomUUID();
  caller.store.append(caller.taskId, {
    type: 'question_asked',
    attemptId: caller.attemptId,
    questionId,
    to,
    text: text.trim(),
  });
  return { questionId, to };
};

export const askCommand = defineCommand({
  meta: {
    name: 'ask',
    description:
      'Ask the operator or a human a question and wait for the answer',
  },
  args: {
    to: {
      type: 'positional',
      required: true,
      description: 'operator or human',
    },
    question: {
      type: 'positional',
      required: true,
      description: 'the question',
    },
  },
  run: async ({ args }) => {
    const { withCaller } = await import('../in-pane');
    await withCaller((caller) => {
      const { to } = runAsk(caller, args.to, args.question);
      console.log(
        `asked ${to}. Stop working and wait: the answer will arrive in this pane. Your timeout is paused until then.`,
      );
    });
  },
});
