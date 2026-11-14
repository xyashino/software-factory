import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { projectIdSchema } from '@repo/factory-core/ids';
import { defineCommand } from 'citty';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

/**
 * `factory admin backup <file>`: online SQLite backup (`VACUUM INTO`) inside the server.
 */
export const adminBackupCommand = defineCommand({
  meta: {
    name: 'backup',
    description: 'Write an online SQLite backup to a file (STORAGE §7)',
  },
  args: {
    ...globalArgs,
    file: {
      type: 'positional',
      required: true,
      description: 'The SQLite backup file to write',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const result = await ctx.client.call('adminBackup', {
        file: resolve(String(args.file)),
      });
      if (ctx.json) printJson(result);
      else {
        console.log(
          `backed up ${result.counts.events} event(s), ${result.counts.blobs} blob(s) to ${result.file}`,
        );
      }
    }),
});

/**
 * `factory admin export <file>`: the whole Factory as one archive (STORAGE §7). The server builds it
 * under its own lock and returns the bytes; the CLI writes them to the file it was given.
 */
export const adminExportCommand = defineCommand({
  meta: {
    name: 'export',
    description: 'Export the Factory to a file (STORAGE §7)',
  },
  args: {
    ...globalArgs,
    file: {
      type: 'positional',
      required: true,
      description: 'The file to write',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const { base64, bytes } = await ctx.client.call('adminExport', {});
      await writeFile(String(args.file), Buffer.from(base64, 'base64'));
      if (ctx.json) printJson({ file: String(args.file), bytes });
      else console.log(`exported ${bytes} bytes to ${String(args.file)}`);
    }),
});

/**
 * `factory admin rebuild-projections`: replays every event stream into the SQLite projection tables.
 */
export const adminRebuildProjectionsCommand = defineCommand({
  meta: {
    name: 'rebuild-projections',
    description: 'Rebuild projection tables from the event log (STORAGE §7)',
  },
  args: { ...globalArgs },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const result = await ctx.client.call('adminRebuildProjections', {});
      if (ctx.json) printJson(result);
      else console.log(`rebuilt projections (${result.rows} order(s))`);
    }),
});

/**
 * `factory admin recover [--project <id>]`: rebuilds the Work orders from git after the database is
 * lost (STORAGE §8). The server runs intake, then one `order_recovered` per fresh order.
 */
export const adminRecoverCommand = defineCommand({
  meta: {
    name: 'recover',
    description:
      'Rebuild Work orders from git after a lost database (STORAGE §8)',
  },
  args: {
    ...globalArgs,
    project: {
      type: 'string',
      required: false,
      description: 'Recover only this project (default: every project)',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const projectId =
        typeof args.project === 'string' && args.project !== ''
          ? projectIdSchema.parse(args.project)
          : undefined;
      const result = await ctx.client.call('adminRecover', {
        ...(projectId === undefined ? {} : { projectId }),
      });
      if (ctx.json) printJson(result);
      else {
        console.log(
          `recovered ${result.recovered.length} Work order(s), skipped ${result.skipped.length}`,
        );
        for (const order of result.recovered) {
          console.log(
            `  ${order.todoId}: ${order.passedStations.length} Station(s) passed${order.delivered ? ', PR exists (delivered)' : ''}, checkpoint ${order.checkpoint}`,
          );
        }
        for (const order of result.skipped) {
          console.log(`  ${order.todoId}: skipped (${order.reason})`);
        }
      }
    }),
});

/**
 * `factory admin import` is offline-only; point operators at `factory-server admin import <file>`.
 */
export const adminImportCommand = defineCommand({
  meta: {
    name: 'import',
    description: 'Import requires a stopped server (use factory-server admin)',
  },
  args: {
    ...globalArgs,
    file: {
      type: 'positional',
      required: false,
      description: 'The export archive to import',
    },
  },
  run: () =>
    withErrors(() => {
      throw new Error(
        'import requires a stopped server; run "factory-server admin import <file>"',
      );
    }),
});

export const adminCommand = defineCommand({
  meta: {
    name: 'admin',
    description: 'Administrative operations on the Factory',
  },
  subCommands: {
    backup: adminBackupCommand,
    export: adminExportCommand,
    import: adminImportCommand,
    'rebuild-projections': adminRebuildProjectionsCommand,
    recover: adminRecoverCommand,
  },
});
