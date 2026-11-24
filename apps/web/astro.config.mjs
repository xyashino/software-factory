import node from '@astrojs/node';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

const SERVER_ENTRY = fileURLToPath(
  new URL('./src/server-entry.ts', import.meta.url),
);

const nodeAdapter = node({ mode: 'standalone' });

const adapter = {
  ...nodeAdapter,
  hooks: {
    ...nodeAdapter.hooks,
    'astro:config:done': (params) =>
      nodeAdapter.hooks['astro:config:done']({
        ...params,
        setAdapter: (value) =>
          params.setAdapter({ ...value, serverEntrypoint: SERVER_ENTRY }),
      }),
  },
};

export default defineConfig({
  output: 'server',
  adapter,
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
  security: { checkOrigin: false },
  server: { host: '127.0.0.1', port: 4322 },
});
