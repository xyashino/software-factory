import { type ArgsDef, type CommandDef, defineCommand } from 'citty';
import { connectCommand } from './connection.command';
import { printError } from './output';
import {
  hqStartCommand,
  hqStopCommand,
  hqTokenAdminCreateCommand,
} from './server.command';
import {
  hqTargetLsCommand,
  hqTargetRmCommand,
  hqTargetUseCommand,
} from './target.command';
import { hqTokenCreateCommand } from './token.command';

const deprecatedAlias = <T extends ArgsDef>(
  cmd: CommandDef<T>,
  replacement: string,
): CommandDef<T> =>
  defineCommand({
    ...cmd,
    run: async (context) => {
      printError(`deprecated: use "${replacement}"`);
      await cmd.run?.(context);
    },
  });

export const legacyCommands = {
  server: defineCommand({
    meta: { name: 'server', description: 'Deprecated: use sf hq' },
    subCommands: {
      start: deprecatedAlias(hqStartCommand, 'sf hq start'),
      stop: deprecatedAlias(hqStopCommand, 'sf hq stop'),
      token: defineCommand({
        meta: { name: 'token', description: 'Deprecated: use sf hq token' },
        subCommands: {
          create: deprecatedAlias(
            hqTokenAdminCreateCommand,
            'sf hq token admin create',
          ),
        },
      }),
    },
  }),
  connect: deprecatedAlias(connectCommand, 'sf hq connect'),
  target: defineCommand({
    meta: { name: 'target', description: 'Deprecated: use sf hq target' },
    subCommands: {
      ls: deprecatedAlias(hqTargetLsCommand, 'sf hq target ls'),
      use: deprecatedAlias(hqTargetUseCommand, 'sf hq target use'),
      rm: deprecatedAlias(hqTargetRmCommand, 'sf hq target rm'),
    },
  }),
  token: defineCommand({
    meta: { name: 'token', description: 'Deprecated: use sf hq token' },
    subCommands: {
      create: deprecatedAlias(hqTokenCreateCommand, 'sf hq token create'),
    },
  }),
};
