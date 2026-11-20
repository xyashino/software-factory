import { config } from '@repo/eslint-config/base';

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    files: ['src/**/*.ts'],
    rules: {
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'prefer-arrow-callback': 'error',
    },
  },
];
