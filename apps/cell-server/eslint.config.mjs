import { config } from '@repo/eslint-config/base';

const LEGACY = {
  group: [
    '@repo/factory-*',
    '@repo/factory-*/*',
    '@repo/cell',
    '@repo/cell/*',
    '@repo/cell-*',
    '@repo/cell-*/*',
  ],
  message:
    'cell-server owns its domain, schema and contracts; it must not import legacy factory or Cell packages (BE_RULES §1.2).',
};

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
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: restricted([LEGACY]),
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: restricted([
      LEGACY,
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
          '**/contracts/**',
        ],
        message:
          'Domain is pure: no I/O, no DB, no Hono, no application code (BE_RULES §2).',
      },
    ]),
  },
  {
    files: ['src/application/**/*.ts'],
    rules: restricted([LEGACY, HTTP, ADAPTERS, BOOTSTRAP]),
  },
  {
    files: ['src/contracts/**/*.ts'],
    rules: restricted([
      LEGACY,
      HTTP,
      ADAPTERS,
      BOOTSTRAP,
      {
        group: ['**/application/**', '**/db/**'],
        message: 'Contracts depend on zod and domain types only (BE_RULES §2).',
      },
    ]),
  },
  {
    files: ['src/db/**/*.ts'],
    rules: restricted([
      LEGACY,
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
