import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Integration tests spawn a factory-server process and run real git; a slow CI box needs more than 5 s.
    testTimeout: 30_000,
  },
});
