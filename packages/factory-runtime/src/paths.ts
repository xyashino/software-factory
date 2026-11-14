import { fileURLToPath } from 'node:url';

/** The Definitions package of this checkout: operators, Lines, templates and runtime prompts. */
export const DEFINITIONS_ROOT = fileURLToPath(
  new URL('../../factory-definitions', import.meta.url),
);
