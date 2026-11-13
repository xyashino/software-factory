import { defineCommand } from 'citty';
import { CallerError } from '../caller';
import type { TaskHandle } from '../management';

/** Answers the task's open question; usable from any shell. */
export const runAnswer = (task: TaskHandle, text: string): string => {
  const question = task.state.openQuestion;
  if (question === undefined) {
    throw new CallerError(`task ${task.taskId} has no open question`);
  }
  if (text.trim().length === 0) {
    throw new CallerError('the answer must not be empty');
  }
  if (question.to === 'human' && task.actor === 'operator') {
    throw new CallerError(
      'this question was asked to a human; the operator may only escalate',
    );
  }
  task.store.append(task.taskId, {
    type: 'answered',
    questionId: question.questionId,
    by: task.actor,
    text: text.trim(),
  });
  return `answered question ${question.questionId}; the agent resumes shortly`;
};

export const answerCommand = defineCommand({
  meta: {
    name: 'answer',
    description: 'Answer the open question of a waiting agent',
  },
  args: {
    taskId: { type: 'positional', required: true, description: 'task id' },
    response: { type: 'positional', required: true, description: 'the answer' },
  },
  run: async ({ args }) => {
    const { withTask } = await import('../management');
    await withTask(args.taskId, (task) => runAnswer(task, args.response));
  },
});
