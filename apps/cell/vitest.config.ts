import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The distributed suite runs real processes; it has its own config and command (`test:distributed`).
    exclude: ['src/__tests__/distributed/**', '**/node_modules/**'],
    // Boundary tests lint a fixture with ESLint; the cold first run can exceed 5 s under load.
    testTimeout: 30_000,
  },
});
