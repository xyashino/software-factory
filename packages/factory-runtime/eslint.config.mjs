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
    // STRUCTURE §2-3: the runtime is transport-free. It has no HTTP, no TCP listener and no v1 code,
    // and it does not call core/cycle (Worker-side policy).
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
              group: ['hono', 'hono/*', 'node:http', 'node:https', 'node:net'],
              message:
                'factory-runtime is transport-free: no HTTP or TCP code (STRUCTURE §2).',
            },
            {
              group: ['@repo/factory-core/cycle', '@repo/factory-core/cycle/*'],
              message:
                'factory-runtime does not call core/cycle (STRUCTURE §3, RULES §4.1).',
            },
          ],
        },
      ],
    },
  },
];
