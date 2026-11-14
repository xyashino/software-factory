import { defineCommand } from 'citty';
import { createContext, flagsOf, globalArgs, withErrors } from '../context';

/**
 * `factory run`: starts `factory-server` in the foreground (PROTOCOL §10). The server takes the
 * writer lock, runs intake, scheduling and the reaper, and serves the socket. The CLI forwards
 * SIGINT and SIGTERM to it and exits with its exit code. A second `run` is refused by the lock.
 */
export const runCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Start factory-server in the foreground (owns the database)',
  },
  args: { ...globalArgs },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const child = Bun.spawn(
        [
          process.execPath,
          ctx.settings.serverBin,
          '--data-dir',
          ctx.settings.dataDir,
        ],
        { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
      );
      const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
      process.on('SIGINT', forward('SIGINT'));
      process.on('SIGTERM', forward('SIGTERM'));
      process.exitCode = await child.exited;
    }),
});
