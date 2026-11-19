import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';

const SERVER_ENTRY = fileURLToPath(
  new URL('./src/server-entry.ts', import.meta.url),
);

// The adapter sets its own server entry, which starts listening before any config check.
// Point it at src/server-entry.ts so the env is validated first.
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
  server: { host: '127.0.0.1', port: 4321 },
});
