---
scope: repo/prompt
summary: Add a shared prompt package with Handlebars rendering
why: Nitpick and the factory each had their own placeholder syntax; one parser and renderer checks inputs and stage for both.
date: 2026-11-17
tags: [prompt, handlebars, frontmatter]
---

- `packages/prompt` parses a prompt file's frontmatter (`id`, `stage`, typed `input`) and renders its body with Handlebars in strict mode.
- zod validates the frontmatter and, per render, a strict object built from the declared inputs. A placeholder the frontmatter does not declare is an error.
- Partials and helpers are passed in by the caller, so the package depends on neither nitpick nor the factory.
