---
scope: factory
summary: Add Astro SSR web demo skeleton with validated env config
why: The web demo needs a buildable Node SSR app with a fixed config shape before any factory-server client code lands; startup must fail fast on a missing project id.
date: 2026-11-19
tags: [factory, web-demo, astro, config]
---

- New `apps/factory-web-demo` (`@repo/factory-web-demo`, private, ESM) with Astro `output: 'server'` on `@astrojs/node` standalone, and one `/` placeholder page in a `Base` layout.
- `loadConfig(env)` validates `FACTORY_URL`, `FACTORY_PROJECT_ID`, `FACTORY_DATA_DIR`, `FACTORY_TOKEN`, `HOST`, `PORT` with Zod and throws naming the bad variable.
- Server entry runs the config check before the adapter starts listening, so a missing `FACTORY_PROJECT_ID` exits non-zero at startup.
- Server binds `127.0.0.1:4321` by default.
- Pins `astro` 7.4.5, `@astrojs/node` 11.1.9 and `@astrojs/check` 0.9.12 in `pnpm-workspace.yaml` catalog, all at least two weeks old at pin time.
- Adds `.astro/` to the root `.gitignore`.
- No factory-server calls, no client scripts, no barrel files.
