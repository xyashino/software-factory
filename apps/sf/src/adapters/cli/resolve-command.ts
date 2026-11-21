import type { ArgsDef, CommandDef } from 'citty';

type Command = CommandDef;

export type ResolvedCommand = {
  cmd: Command;
  parent: Command | undefined;
  unknownToken: boolean;
  rest: string[];
};

const subCommandsOf = (cmd: Command): Record<string, Command> | undefined => {
  const { subCommands } = cmd;
  if (
    typeof subCommands !== 'object' ||
    subCommands === null ||
    subCommands instanceof Promise
  ) {
    return undefined;
  }
  return subCommands as Record<string, Command>;
};

const aliasesOf = (cmd: Command): string[] => {
  const meta = cmd.meta;
  if (typeof meta !== 'object' || meta === null || meta instanceof Promise) {
    return [];
  }
  const { alias } = meta;
  if (alias === undefined) {
    return [];
  }
  return Array.isArray(alias) ? alias : [alias];
};

const findSub = (cmd: Command, token: string): Command | undefined => {
  const subs = subCommandsOf(cmd);
  if (subs === undefined) {
    return undefined;
  }
  const direct = subs[token];
  if (direct !== undefined) {
    return direct;
  }
  return Object.values(subs).find((sub) => aliasesOf(sub).includes(token));
};

const takesValue = (cmd: Command, flag: string): boolean => {
  const args = cmd.args;
  if (typeof args !== 'object' || args === null || args instanceof Promise) {
    return false;
  }
  const name = flag.replace(/^-+/, '');
  const def = args[name];
  return (
    def !== undefined && def.type !== 'boolean' && def.type !== 'positional'
  );
};

export const argsOf = (cmd: Command): ArgsDef => {
  const { args } = cmd;
  if (typeof args !== 'object' || args === null || args instanceof Promise) {
    return {};
  }
  return args;
};

export const resolveCommand = (
  main: Command,
  rawArgs: readonly string[],
): ResolvedCommand => {
  let cmd = main;
  let parent: Command | undefined;
  let restFrom = 0;
  const result = (unknownToken: boolean): ResolvedCommand => ({
    cmd,
    parent,
    unknownToken,
    rest: rawArgs.slice(restFrom),
  });
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index] ?? '';
    if (token === '--') {
      break;
    }
    if (token.startsWith('-')) {
      if (!token.includes('=') && takesValue(cmd, token)) {
        index += 1;
      }
      continue;
    }
    const sub = findSub(cmd, token);
    if (sub !== undefined) {
      parent = cmd;
      cmd = sub;
      restFrom = index + 1;
      continue;
    }
    return result(subCommandsOf(cmd) !== undefined);
  }
  return result(false);
};
