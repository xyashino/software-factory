import { fileURLToPath } from 'node:url';

/**
 * The `.factory/` directory of this checkout: operators, Lines and templates of the software-factory
 * repository itself. The server still reads it at startup until the server task API replaces it
 * (passive-server-03); runtime prompts come from the Definitions package.
 */
export const DEFINITIONS_ROOT = fileURLToPath(
  new URL('../../../.factory', import.meta.url),
);
