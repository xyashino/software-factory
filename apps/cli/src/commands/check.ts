import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { check } from '@repo/factory-definitions/check';
import { resolveCatalog } from '@repo/factory-definitions/nitpick-catalog';
import { FACTORY_DIR } from '@repo/factory-definitions/load';
import { globalArgs, printJson, withErrors } from '../context';

/**
 * `factory check [--dir <repoRoot>]`: validates `<repoRoot>/.factory/` (Operator profiles, Lines, prompt
 * and PR templates) offline. When the repository has a catalog (.factory/config.json or.nitpick/),
 * declared rules and skills are cross-checked against it. No server, no database. Exits 1 when any definition
 * is wrong, printing one diagnostic per file; `--json` prints `{ok, errors}` instead.
 */
export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description:
      'Validate .factory/ definitions and the catalog cross-check (offline)',
  },
  args: {
    ...globalArgs,
    dir: {
      type: 'string',
      description: 'The repository root (default: the working directory)',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const repo = resolve(
        typeof args.dir === 'string' ? args.dir : process.cwd(),
      );
      const factoryRoot = join(repo, FACTORY_DIR);
      if (!existsSync(factoryRoot)) {
        throw new Error(
          `no ${FACTORY_DIR}/ in ${repo}; run factory init to scaffold it`,
        );
      }
      const catalog = await resolveCatalog(repo);
      const errors = check(factoryRoot, { catalog });
      if (args.json === true) {
        printJson({ ok: errors.length === 0, errors });
        if (errors.length > 0) process.exitCode = 1;
        return;
      }
      if (errors.length === 0) {
        console.log('definitions pass');
        return;
      }
      for (const error of errors) {
        console.error(`${error.file} ${error.field}: ${error.message}`);
      }
      process.exitCode = 1;
    }),
});
