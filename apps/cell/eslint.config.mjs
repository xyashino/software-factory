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
            {
              group: ['@repo/factory-server', '@repo/factory-server/*'],
              message:
                'apps/cell does not import factory-server (PROTOCOL §2, STRUCTURE §3).',
            },
          ],
        },
      ],
    },
  },
  {
    // passive-server-03: the Cell renders the Operator prompt, the Mechanic prompt and the PR body from the repo's own
    // `.factory/` (PROTOCOL §4). `render.ts` is the one module that reads definitions and calls the pure prompt
    // builders; the rest of the Cell keeps the restriction above. Narrow on purpose: widen it only by decision.
    files: ['src/jobs/render.ts'],
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
              group: ['@repo/factory-server', '@repo/factory-server/*'],
              message:
                'apps/cell does not import factory-server (PROTOCOL §2, STRUCTURE §3).',
            },
          ],
        },
      ],
    },
  },
  {
    // The e2e tests boot a real factory-server and runtime on a temp socket, and the distributed suite
    // runs real factory-server and factory-cell processes: the places a Cell test may import them.
    // Everything else in the restriction above still applies.
    files: ['src/__tests__/e2e/**/*.ts', 'src/__tests__/distributed/**/*.ts'],
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
          ],
        },
      ],
    },
  },
];
