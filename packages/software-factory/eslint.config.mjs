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
    // RULES 1.2: the engine is pure. It may import only its own files and definitions/types.
    files: ['src/engine/**/*.ts'],
    ignores: ['src/engine/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/adapters/**',
                '**/supervisor/**',
                '**/cli/**',
                '**/ports/**',
              ],
              message:
                'The engine is pure: it may not import adapters, supervisor, cli or ports.',
            },
            {
              group: ['bun:*', 'node:*'],
              message: 'The engine performs no runtime I/O.',
            },
            {
              group: ['../definitions/*', '!../definitions/types'],
              message: 'The engine may import definitions/types only.',
            },
          ],
        },
      ],
    },
  },
];
