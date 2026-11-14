import { defineConfig } from 'vitest/config';

/**
 * The distributed suite (ROADMAP v2-15): one `factory-server`, several `factory-cell` processes, a fake
 * runner and a hostile proxy per Cell. Files run one at a time, since each one owns real processes and
 * ports. A flake is a failure: no retries.
 */
export default defineConfig({
  test: {
    include: ['src/__tests__/distributed/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    retry: 0,
  },
});
