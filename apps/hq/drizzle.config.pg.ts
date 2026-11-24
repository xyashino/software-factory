import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/pg/schema/*.ts',
  out: './src/db/pg/migrations',
});
