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
    // STRUCTURE §3, RULES §4.2: a Cell gets everything in the Job; no db, no definitions.
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
              message: 'apps/cell does not import factory-db (RULES §4.2).',
            },
            {
              group: [
                '@repo/factory-definitions',
                '@repo/factory-definitions/*',
              ],
              message:
                'apps/cell does not import factory-definitions (RULES §4.2).',
            },
            {
              group: ['@repo/factory-runtime', '@repo/factory-runtime/*'],
              message:
                'apps/cell does not import the runtime library; it talks to factory-server over the socket (PROTOCOL §2).',
            },
          ],
        },
      ],
    },
  },
];
