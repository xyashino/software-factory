import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit reads `src/schema.ts` (the only schema definition, STORAGE §9) and writes migrations to
 * `drizzle/`. Run `pnpm --filter @repo/factory-db db:generate` after every schema change.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
});
