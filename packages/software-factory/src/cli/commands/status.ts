import { defineCommand } from 'citty';

const CLEAR = '\u001b[2J\u001b[H';

export const statusCommand = defineCommand({
  meta: {
    name: 'status',
    description:
      'Show every task: step, attempt, retries, durations, tokens and cost',
  },
  args: {
    watch: {
      type: 'boolean',
      description: 'Redraw every second until interrupted',
      default: false,
    },
  },
  async run({ args }) {
    const [
      { colorPaint },
      { openReadOnlyStore },
      { boardRows, renderBoard },
      wire,
    ] = await Promise.all([
      import('../../paint'),
      import('../read-store'),
      import('../board'),
      import('../../supervisor/wire'),
    ]);
    const { loadShippedDefinitions, resolveRoot } = wire;
    const root = resolveRoot(process.cwd(), process.env);
    const definitions = loadShippedDefinitions();
    const { store, close } = openReadOnlyStore(root);
    const draw = (): void => {
      const rows = boardRows(store, definitions, Date.now());
      const text = renderBoard(rows, colorPaint);
      if (args.watch) process.stdout.write(CLEAR);
      console.log(text);
    };
    try {
      draw();
      if (!args.watch) return;
      await new Promise<void>((resolve) => {
        const timer = setInterval(draw, 1000);
        const stop = (): void => {
          clearInterval(timer);
          resolve();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    } finally {
      close();
    }
  },
});
