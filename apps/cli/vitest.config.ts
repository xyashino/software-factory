import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests start real processes (factory-server, one-shot runs) and wait for them.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
