import { fileURLToPath } from 'node:url';

/** The software-factory package root, used to load the shipped roles and templates. */
export const PACKAGE_ROOT_FOR_TESTS = fileURLToPath(
  new URL('../../..', import.meta.url),
);
