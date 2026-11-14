import { defineCommand } from 'citty';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

/**
 * `factory sync` runs intake now (PROTOCOL §3.1, `/v1/supervisor/intake/sync`).
 */
export const syncCommand = defineCommand({
  meta: {
    name: 'sync',
    description: 'Run intake now instead of waiting for the next poll',
  },
  args: { ...globalArgs },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const result = await ctx.client.call('intakeSync', {
        commandId: ctx.commandId(),
      });
      if (ctx.json) return printJson(result);
      console.log(`intake ran: ${result.created} Work order(s) created`);
    }),
});
