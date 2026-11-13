import { defineCommand } from 'citty';

export const resetCommand = defineCommand({
  meta: {
    name: 'reset',
    description:
      'Reset software factory state: queues, database, logs, worktrees and todos',
  },
  args: {
    hard: {
      type: 'boolean',
      description:
        'Perform a full hard reset including worktrees and evidences (default: true)',
      default: true,
    },
    todos: {
      type: 'boolean',
      description: 'Reset status in todos/*.md back to todo (default: true)',
      default: true,
    },
    force: {
      type: 'boolean',
      description: 'Force reset even if supervisor lock is held',
      default: false,
    },
  },
  async run({ args }) {
    const { runReset } = await import('../reset-action');
    await runReset(args);
  },
});
