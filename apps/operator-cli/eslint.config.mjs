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
    // STRUCTURE §2-3: the Operator CLI sees contracts only; no db, no definitions, no core/cycle.
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
              group: ['@repo/factory-db', '@repo/factory-db/*'],
              message:
                'apps/operator-cli does not import factory-db (STRUCTURE §3).',
            },
            {
              group: [
                '@repo/factory-definitions',
                '@repo/factory-definitions/*',
              ],
              message:
                'apps/operator-cli does not import factory-definitions (STRUCTURE §3).',
            },
            {
              group: ['@repo/factory-core/cycle', '@repo/factory-core/cycle/*'],
              message:
                'apps/operator-cli does not import core/cycle (STRUCTURE §3).',
            },
          ],
        },
      ],
    },
  },
];
