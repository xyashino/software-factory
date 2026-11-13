import { defineCommand } from 'citty';
import { CallerError } from '../caller';
import type { TaskHandle } from '../management';

/**
 * Resumes a blocked task. What happens follows the block: an exhausted retry
 * budget gets one extra retry per task; a runner prompt gets either `--choose N`
 * (presses the menu option N or letter like y/n, then Enter) or `--nudge` text
 * typed into the pane. Everything else needs an answer or an escalation.
 * A parked task (or a plain unblock with no prompt options) is queued instead,
 * whatever its block.
 */
export const runUnblock = (
  task: TaskHandle,
  nudge: string | undefined,
  choose?: string,
): string => {
  const block = task.state.block;
  if (block === undefined) {
    throw new CallerError(`task ${task.taskId} is not blocked`);
  }
  if (task.state.status === 'parked') return requeueParked(task, nudge, choose);
  switch (block.reason) {
    case 'retries_exhausted': {
      if (task.state.extraRetry !== undefined) {
        throw new CallerError(
          'the extra retry of this task was already granted; escalate instead',
        );
      }
      task.store.append(task.taskId, {
        type: 'unblocked',
        by: task.actor,
        extraRetry: true,
      });
      return `unblocked task ${task.taskId} with one extra retry`;
    }
    case 'runner_prompt': {
      const text = nudge?.trim() ?? '';
      const option = choose?.trim() ?? '';
      if (option.length > 0 && text.length > 0) {
        throw new CallerError('use either --choose or --nudge, not both');
      }
      if (option.length > 0) {
        if (!/^[1-9a-zA-Z]$/.test(option)) {
          throw new CallerError(
            '--choose takes a menu number from 1 to 9 or a letter (e.g. y/n)',
          );
        }
        task.store.append(task.taskId, {
          type: 'unblocked',
          by: task.actor,
          keys: [option, 'Enter'],
        });
        return `unblocked task ${task.taskId}; menu option ${option} goes to the pane`;
      }
      if (text.length === 0) {
        throw new CallerError(
          'a runner prompt needs --choose <menu number> or --nudge "<text to type into the pane>"',
        );
      }
      task.store.append(task.taskId, {
        type: 'unblocked',
        by: task.actor,
        nudge: text,
      });
      return `unblocked task ${task.taskId}; the nudge goes to the pane`;
    }
    case 'infra':
    case 'question':
    case 'no_retry':
    case 'setup_failed':
    case 'delivery_failed':
      if (nudge === undefined && choose === undefined) {
        return requeueParked(task, nudge, choose);
      }
      throw new CallerError(
        `a "${block.reason}" block cannot be unblocked; use \`sf answer\` or \`sf escalate\``,
      );
  }
};

/**
 * A parked task already left the line, so any block reason may be lifted. The
 * task goes back to `queued` and waits for the line to be free; it never
 * pre-empts the task that runs now.
 */
const requeueParked = (
  task: TaskHandle,
  nudge: string | undefined,
  choose: string | undefined,
): string => {
  const text = nudge?.trim() ?? '';
  const option = choose?.trim() ?? '';
  if (option.length > 0 && text.length > 0) {
    throw new CallerError('use either --choose or --nudge, not both');
  }
  if (option.length > 0 && !/^[1-9a-zA-Z]$/.test(option)) {
    throw new CallerError(
      '--choose takes a menu number from 1 to 9 or a letter (e.g. y/n)',
    );
  }
  // A human unblock of a retry budget or an infra block grants one extra start.
  const extraRetry =
    (task.state.block?.reason === 'retries_exhausted' ||
      task.state.block?.reason === 'infra') &&
    task.state.extraRetry === undefined;
  task.store.append(task.taskId, {
    type: 'unblocked',
    by: task.actor,
    ...(extraRetry ? { extraRetry: true } : {}),
    ...(text.length > 0 ? { nudge: text } : {}),
    ...(option.length > 0 ? { keys: [option, 'Enter'] } : {}),
  });
  task.store.setTaskStatus(task.taskId, 'queued');
  return `unblocked task ${task.taskId}; it is queued until the line is free`;
};

export const unblockCommand = defineCommand({
  meta: {
    name: 'unblock',
    description:
      'Resume a blocked task: one extra retry, a menu choice or a pane nudge',
  },
  args: {
    taskId: { type: 'positional', required: true, description: 'task id' },
    nudge: {
      type: 'string',
      description: 'Text typed into the blocked pane (runner prompts)',
    },
    choose: {
      type: 'string',
      description:
        'Menu option to press in the blocked pane, then Enter (runner prompts)',
    },
  },
  run: async ({ args }) => {
    const { withTask } = await import('../management');
    await withTask(args.taskId, (task) =>
      runUnblock(task, args.nudge, args.choose),
    );
  },
});
