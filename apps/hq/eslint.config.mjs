import { config } from '@repo/eslint-config/base';

const HTTP = {
  group: ['hono', 'hono/*'],
  message: 'Only adapters import Hono (BE_RULES §2).',
};

const ADAPTERS = {
  group: ['**/adapters/**'],
  message: 'Inner layers depend on ports, never on adapters (BE_RULES §2).',
};

const BOOTSTRAP = {
  group: ['**/bootstrap/**'],
  message: 'Only the composition root imports bootstrap (BE_RULES §2).',
};

const restricted = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'prefer-arrow-callback': 'error',
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: restricted([
      HTTP,
      ADAPTERS,
      BOOTSTRAP,
      {
        group: [
          'drizzle-orm',
          'drizzle-orm/*',
          'bun:sqlite',
          'node:*',
          '**/db/**',
          '**/application/**',
        ],
        message:
          'Domain is pure: no I/O, no DB, no Hono, no application code (BE_RULES §2).',
      },
    ]),
  },
  {
    files: ['src/application/**/*.ts'],
    rules: restricted([HTTP, ADAPTERS, BOOTSTRAP]),
  },
  {
    files: ['src/db/**/*.ts'],
    rules: restricted([
      HTTP,
      ADAPTERS,
      BOOTSTRAP,
      {
        group: ['**/application/**'],
        message: 'The DB layer never calls procedures (BE_RULES §2).',
      },
    ]),
  },
];
