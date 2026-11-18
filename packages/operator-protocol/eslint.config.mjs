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
    // Schemas and constants only: no process, filesystem or network access.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'operator-protocol holds schemas only.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'process',
              message: 'operator-protocol holds schemas only.',
            },
            {
              name: 'node:process',
              message: 'operator-protocol holds schemas only.',
            },
            {
              name: 'node:fs',
              message: 'operator-protocol holds schemas only.',
            },
            {
              name: 'node:net',
              message: 'operator-protocol holds schemas only.',
            },
            {
              name: 'node:http',
              message: 'operator-protocol holds schemas only.',
            },
          ],
        },
      ],
    },
  },
];
