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
    // STRUCTURE §3: factory-definitions depends on factory-core only.
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
                'factory-definitions does not depend on factory-db (STRUCTURE §3).',
            },
            {
              group: ['@repo/factory-core/cycle', '@repo/factory-core/cycle/*'],
              message:
                'factory-definitions does not call core/cycle (STRUCTURE §3).',
            },
          ],
        },
      ],
    },
  },
];
