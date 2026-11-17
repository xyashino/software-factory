import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Boundary tests lint a fixture with ESLint; the cold first run can exceed 5 s under load.
    testTimeout: 30_000,
  },
});
