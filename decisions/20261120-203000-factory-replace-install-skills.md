---
scope: factory
summary: Replace setup-factory and vps-gon-stack with factory-install skill
why: Old skills documented removed v1 and omino commands; agents following them could not install or run sf
date: 2026-11-20
tags: [skills, docs, install]
---

- Deleted `setup-factory` and `vps-gon-stack` skills and their synced `.agents/skills` copies.
- Added `factory-install` skill: prerequisites, `pnpm build:sf` + `scripts/install.sh`, repo onboarding via `sf`, multi-cell and remote-brain notes, stop commands.
- Registered in `.nitpick/config.ts`; regenerated with `pnpm nitpick:sync`.
