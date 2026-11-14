import { defineCommand } from 'citty';
import type { CellId } from '@repo/factory-core/ids';
import { parseDuration } from '@repo/factory-definitions/duration';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

/** `--ttl` values are read by `parseDuration` (30s, 20m, 1h) and sent as whole seconds. */
export const parseTtl = (text: string): number => {
  const ms = parseDuration(text);
  if (ms === null) {
    throw new Error(`--ttl must look like 30s, 20m or 1h, not "${text}"`);
  }
  return ms / 1_000;
};

/** `factory cells`: the registry, one row per Cell with its last heartbeat (PROTOCOL §3.1). */
const listCells = (args: Record<string, unknown>) =>
  withErrors(async () => {
    const ctx = createContext(flagsOf(args));
    const { cells } = await ctx.client.call('cellsList', {});
    if (ctx.json) return printJson({ cells });
    if (cells.length === 0) return console.log('no cells');
    console.log(
      ctx.paint.dim(
        `${'CELL'.padEnd(28)} ${'NAME'.padEnd(20)} ${'LAST SEEN'.padEnd(24)} STATE`,
      ),
    );
    for (const cell of cells) {
      const seen =
        cell.lastSeenAt === null
          ? '-'
          : new Date(cell.lastSeenAt).toISOString();
      const state = cell.revokedAt === null ? 'active' : 'revoked';
      console.log(
        `${cell.cellId.padEnd(28)} ${cell.name.padEnd(20)} ${seen.padEnd(24)} ${state}`,
      );
    }
  });

export const cellsListCommand = defineCommand({
  meta: { name: 'list', description: 'List the Cells' },
  args: { ...globalArgs },
  run: ({ args }) => listCells(args),
});

/** `factory cells rm <id>`: revokes a Cell; its leases expire at the next reaper pass (PROTOCOL §1). */
export const cellsRmCommand = defineCommand({
  meta: { name: 'rm', description: 'Revoke a Cell' },
  args: {
    ...globalArgs,
    cell: { type: 'positional', required: true, description: 'The Cell id' },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const result = await ctx.client.call('cellRevoke', {
        cellId: String(args.cell) as CellId,
      });
      if (ctx.json) printJson(result);
      else console.log(`revoked ${result.cellId}`);
    }),
});

/** `factory cells token create [--ttl <d>] [--name <n>]`: the token is printed once (PROTOCOL §1). */
export const tokenCreateCommand = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a join token; it is shown once',
  },
  args: {
    ...globalArgs,
    ttl: {
      type: 'string',
      description: 'Expires after this long: 30s, 20m or 1h',
    },
    name: { type: 'string', description: 'A label for the token' },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const ttlSeconds =
        args.ttl === undefined ? undefined : parseTtl(String(args.ttl));
      const result = await ctx.client.call('joinTokenCreate', {
        commandId: ctx.commandId(),
        name: args.name === undefined ? 'join token' : String(args.name),
        ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
      });
      if (ctx.json) {
        printJson(result);
        return;
      }
      console.log(result.token);
      const expiry =
        result.expiresAt === null
          ? ''
          : `, expires ${new Date(result.expiresAt).toISOString()}`;
      console.error(
        `join token ${result.joinTokenId} (${result.name}), shown once${expiry}`,
      );
    }),
});

/** `factory cells token ls`: the tokens, without their values (PROTOCOL §1). */
export const tokenLsCommand = defineCommand({
  meta: { name: 'ls', description: 'List join tokens' },
  args: { ...globalArgs },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const { tokens } = await ctx.client.call('joinTokenList', {});
      if (ctx.json) return printJson({ tokens });
      if (tokens.length === 0) return console.log('no join tokens');
      for (const token of tokens) {
        const state =
          token.revokedAt !== null
            ? 'revoked'
            : token.expiresAt !== null && token.expiresAt <= ctx.now()
              ? 'expired'
              : 'active';
        console.log(`${token.joinTokenId}  ${token.name.padEnd(20)} ${state}`);
      }
    }),
});

/** `factory cells token rm <id>`: revokes a join token (PROTOCOL §1). */
export const tokenRmCommand = defineCommand({
  meta: { name: 'rm', description: 'Revoke a join token' },
  args: {
    ...globalArgs,
    token: {
      type: 'positional',
      required: true,
      description: 'The join token id',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const result = await ctx.client.call('joinTokenRevoke', {
        joinTokenId: String(args.token),
      });
      if (ctx.json) printJson(result);
      else console.log(`revoked join token ${result.joinTokenId}`);
    }),
});

const tokenCommand = defineCommand({
  meta: { name: 'token', description: 'Manage join tokens' },
  subCommands: {
    create: tokenCreateCommand,
    ls: tokenLsCommand,
    rm: tokenRmCommand,
  },
});

/** `factory cells`: the list by default, `rm <id>`, and `token create | ls | rm`. */
export const cellsCommand = defineCommand({
  meta: {
    name: 'cells',
    description: 'List or revoke Cells, manage join tokens',
  },
  args: { ...globalArgs },
  subCommands: {
    rm: cellsRmCommand,
    token: tokenCommand,
  },
  run: ({ args }) => listCells(args),
});
