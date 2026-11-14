import { fileURLToPath } from 'node:url';
import { defineCommand } from 'citty';
import { check } from '@repo/factory-definitions/check';
import { withErrors } from '../context';

/** The Definitions package of this checkout: Operator profiles, Lines and templates. */
export const DEFINITIONS_ROOT = fileURLToPath(
  new URL('../../../../packages/factory-definitions', import.meta.url),
);

/**
 * `factory check`: validates Operator profiles, Lines and templates offline (PROTOCOL §10). It reads
 * the Definitions package only; no server, no database. Exits 1 when any definition is wrong.
 */
export const checkCommand = defineCommand({
  meta: {
    name: 'check',
    description: 'Validate Operator profiles, Lines and templates (offline)',
  },
  args: {},
  run: () =>
    withErrors(async () => {
      const errors = check(DEFINITIONS_ROOT);
      if (errors.length === 0) {
        console.log('definitions pass');
        return;
      }
      for (const error of errors) {
        console.error(`${error.file}: ${error.field}: ${error.message}`);
      }
      throw new Error(`${errors.length} definition error(s)`);
    }),
});
