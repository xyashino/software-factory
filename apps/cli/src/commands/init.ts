import { join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { FACTORY_DIR } from '@repo/factory-definitions/load';
import { scaffoldFactory } from '@repo/factory-definitions/scaffold';
import { globalArgs, printJson, withErrors } from '../context';

/**
 * `factory init [--dir <repoRoot>] [--force]`: scaffolds `<repoRoot>/.factory/` (Lines, Operators,
 * prompt and PR templates) from the starter this package ships. It writes files only, no server.
 * A repository that already has `.factory/` is refused unless `--force`, which overwrites the starter
 * files and keeps every other file.
 */
export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description:
      'Scaffold .factory/ (Lines, Operators, templates) in a repository',
  },
  args: {
    ...globalArgs,
    dir: {
      type: 'string',
      description: 'The repository root (default: the working directory)',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite the starter files of an existing .factory/',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const repo = resolve(
        typeof args.dir === 'string' ? args.dir : process.cwd(),
      );
      const { written } = scaffoldFactory(repo, { force: args.force === true });
      const dir = join(repo, FACTORY_DIR);
      if (args.json === true) return printJson({ dir, written });
      console.log(`initialized ${dir} (${written.length} files)`);
    }),
});
