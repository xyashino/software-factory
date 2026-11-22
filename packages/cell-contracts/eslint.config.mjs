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
    // Schemas and constants only: no process, filesystem, network or Hono access.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'cell-contracts holds schemas only.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'process', message: 'cell-contracts holds schemas only.' },
            {
              name: 'node:process',
              message: 'cell-contracts holds schemas only.',
            },
            { name: 'node:fs', message: 'cell-contracts holds schemas only.' },
            { name: 'node:net', message: 'cell-contracts holds schemas only.' },
            {
              name: 'node:http',
              message: 'cell-contracts holds schemas only.',
            },
            { name: 'hono', message: 'cell-contracts holds schemas only.' },
          ],
          patterns: [
            {
              group: ['@repo/cell/*', '@repo/sf', '@repo/sf/*'],
              message: 'cell-contracts must not import apps.',
            },
          ],
        },
      ],
    },
  },
];
