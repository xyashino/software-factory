import { config } from '@repo/eslint-config/react';

/** @type {import("eslint").Linter.Config} */
export default [
  ...config,
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.{ts,tsx}'],
    rules: {
      'func-style': ['error', 'expression', { allowArrowFunctions: true }],
      'prefer-arrow-callback': 'error',
    },
  },
];
