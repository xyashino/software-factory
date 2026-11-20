import { defineConfig, type Plugin } from 'vitest/config';

const sqlAsText = (): Plugin => ({
  name: 'sql-as-text',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.sql')) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
});

export default defineConfig({
  plugins: [sqlAsText()],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
