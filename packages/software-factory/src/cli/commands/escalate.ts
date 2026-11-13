import { defineCommand } from 'citty';
import { CallerError } from '../caller';
import type { TaskHandle } from '../management';

/** Hands a blocked task or an open question over to a human with a summary. */
export const runEscalate = (task: TaskHandle, text: string): string => {
  if (text.trim().length === 0) {
    throw new CallerError('the escalation reason must not be empty');
  }
  if (task.state.block === undefined && task.state.openQuestion === undefined) {
    throw new CallerError(
      `task ${task.taskId} is neither blocked nor waiting on a question`,
    );
  }
  task.store.append(task.taskId, { type: 'escalated', text: text.trim() });
  return `escalated task ${task.taskId} to a human`;
};

export const escalateCommand = defineCommand({
  meta: {
    name: 'escalate',
    description: 'Hand a blocked task over to a human with a summary',
  },
  args: {
    taskId: { type: 'positional', required: true, description: 'task id' },
    reason: { type: 'positional', required: true, description: 'summary' },
  },
  run: async ({ args }) => {
    const { withTask } = await import('../management');
    await withTask(args.taskId, (task) => runEscalate(task, args.reason));
  },
});
