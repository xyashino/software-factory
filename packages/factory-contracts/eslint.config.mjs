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
    // Schemas and constants only: no process, filesystem, network or server runtime.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'hq-contracts holds schemas only.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'bun:*', 'hono', 'hono/*', '**/apps/**'],
              message: 'hq-contracts holds schemas only.',
            },
          ],
        },
      ],
    },
  },
];
