import { defineCommand } from 'citty';

export const logCommand = defineCommand({
  meta: {
    name: 'log',
    description: 'Show the event log of one task',
  },
  args: {
    taskId: {
      type: 'positional',
      required: true,
      description: 'the task id',
    },
    json: {
      type: 'boolean',
      description: 'print the events as JSON',
      default: false,
    },
  },
  async run({ args }) {
    const [
      { openReadOnlyStore },
      { logLines },
      { resolveRoot },
      { colorPaint },
    ] = await Promise.all([
      import('../read-store'),
      import('../log-view'),
      import('../../supervisor/wire'),
      import('../../paint'),
    ]);
    const root = resolveRoot(process.cwd(), process.env);
    const { store, close } = openReadOnlyStore(root);
    try {
      const taskId = args.taskId;
      if (!store.tasks().some((task) => task.id === taskId)) {
        console.error(`software-factory: no task "${taskId}"`);
        process.exitCode = 1;
        return;
      }
      const events = store.events(taskId);
      if (args.json) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }
      for (const line of logLines(events, colorPaint)) console.log(line);
    } finally {
      close();
    }
  },
});
