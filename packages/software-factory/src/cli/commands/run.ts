import { defineCommand } from 'citty';

export const runCommand = defineCommand({
  meta: {
    name: 'run',
    description:
      'Run the supervisor: pick todos and drive them through their workflows',
  },
  async run() {
    const [
      { openSupervisorPorts, resolveRoot },
      { runSupervisor },
      { colorPaint },
      { acquireSupervisorLock },
    ] = await Promise.all([
      import('../../supervisor/wire'),
      import('../../supervisor/run'),
      import('../../paint'),
      import('../../supervisor/lock'),
    ]);
    const root = resolveRoot(process.cwd(), process.env);
    const acquired = acquireSupervisorLock(root);
    if (!acquired.ok) {
      const { holder, path } = acquired.error;
      console.error(
        colorPaint.red(
          holder
            ? `sf run already running: pid ${holder.pid} since ${holder.startedAt}`
            : `sf run already running: lock held at ${path}`,
        ),
      );
      process.exitCode = 1;
      return;
    }
    const lock = acquired.value;
    const releaseOnExit = (): void => lock.release();
    process.on('exit', releaseOnExit);
    const { ports, close } = (() => {
      try {
        return openSupervisorPorts(root);
      } catch (error) {
        lock.release();
        throw error;
      }
    })();
    const controller = new AbortController();
    let signals = 0;
    const stop = (): void => {
      signals += 1;
      if (signals > 1) process.exit(130);
      console.log(
        colorPaint.yellow(
          'stopping after the current step; press Ctrl+C again to force',
        ),
      );
      controller.abort();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    try {
      await runSupervisor(ports, {
        signal: controller.signal,
        log: (line) => console.log(line),
        paint: colorPaint,
      });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      close();
      lock.release();
      process.off('exit', releaseOnExit);
    }
  },
});
