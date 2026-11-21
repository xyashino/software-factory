---
scope: docs
summary: Remove dead links, schema dump, endpoint index and roadmap
why: Dead todo links and copied schema and routes drift and cost tokens; design stays
date: 2026-11-21
tags: [docs, factory, web-demo]
---

- Factory `docs/README.md`: task table and mermaid removed, now a pointer list.
- Factory PLAN §7: schema dump replaced by pointer to `apps/factory/src/db/schema`.
  - SQLite exclusivity rationale (1 Cell per WorkOrder) kept as 3 bullets.
- Factory PLAN §2.2: column lists replaced by one line per table group.
- Factory PLAN §9: endpoint table replaced by pointer to `apps/factory/src/contracts`.
- Factory PLAN §10 roadmap and `todo/` links removed. §0 and §11.1 refs repointed.
- Web-demo PLAN §6 task table removed. "Out of scope" renumbered §6. `web-demo-06` refs removed.
- `apps/operator/docs` already gone with operator app. No operator todo row left.
- Link scan: no relative link in `apps/*/docs/*.md` or root `README.md` targets a missing file.
- Factory PLAN 911 -> 662 lines. Design sections (flow, principles, state, Cell, incidents, queue, topology, tokens, agent reporting) unchanged in meaning.
