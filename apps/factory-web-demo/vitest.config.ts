import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
    // Two blackbox files each run `astro build` into the same dist/; in parallel one imports half-written chunks.
    fileParallelism: false,
  },
});
