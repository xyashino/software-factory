import { config } from '@repo/eslint-config/base';

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
    // STRUCTURE §3: the server may not call core/cycle (Worker-side policy).
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@repo/software-factory', '@repo/software-factory/*'],
              message:
                'v2 packages must not import the v1 package (STRUCTURE §4).',
            },
            {
              group: ['@repo/factory-core/cycle', '@repo/factory-core/cycle/*'],
              message:
                'apps/server does not import core/cycle (STRUCTURE §3, RULES §4.1).',
            },
            {
              group: ['@repo/factory-db', '@repo/factory-db/*'],
              message:
                'apps/server reaches the database only through factory-runtime (STRUCTURE §3).',
            },
            {
              group: [
                '@repo/factory-definitions',
                '@repo/factory-definitions/*',
              ],
              message:
                'apps/server does not load definitions; factory-runtime does (STRUCTURE §3).',
            },
          ],
        },
      ],
    },
  },
];
