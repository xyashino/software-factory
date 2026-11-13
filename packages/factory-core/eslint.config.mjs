import { config } from '@repo/eslint-config/base';

const V1_PACKAGE = {
  group: ['@repo/software-factory', '@repo/software-factory/*'],
  message: 'v2 packages must not import the v1 package (STRUCTURE §4).',
};
const DB_PACKAGE = {
  group: ['@repo/factory-db', '@repo/factory-db/*'],
  message: 'factory-core is below factory-db (STRUCTURE §3).',
};
const DEFINITIONS_PACKAGE = {
  group: ['@repo/factory-definitions', '@repo/factory-definitions/*'],
  message: 'factory-core is below factory-definitions (STRUCTURE §3).',
};

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    // Function style: arrow function expressions only, in implementation and tests.
    files: ['src/**/*.ts'],
    rules: {
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'prefer-arrow-callback': 'error',
    },
  },
  {
    // RULES §1.1: factory-core is pure. No runtime I/O, no bun:* or node:* imports.
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            V1_PACKAGE,
            DB_PACKAGE,
            DEFINITIONS_PACKAGE,
            {
              group: ['bun:*', 'node:*'],
              message: 'factory-core performs no runtime I/O (RULES §1.1).',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests may use node:* for the purity scan; they keep the workspace bans.
    files: ['src/**/__tests__/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [V1_PACKAGE, DB_PACKAGE, DEFINITIONS_PACKAGE] },
      ],
    },
  },
];
