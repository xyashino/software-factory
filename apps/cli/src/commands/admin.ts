import { writeFile } from 'node:fs/promises';
import { defineCommand } from 'citty';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

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

export const adminCommand = defineCommand({
  meta: {
    name: 'admin',
    description: 'Administrative operations on the Factory',
  },
  subCommands: { export: adminExportCommand },
});
