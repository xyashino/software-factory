---
scope: repo/todos
summary: Align todos with universal repo-first Factory and thin HQ bridge
why: Move execution and forge decisions from HQ into local Factory while keeping HQ as Web UI bridge and adding universal lines, ROLE.md, and OEE metrics
date: 2026-11-26
tags: [todos, architecture, universal-engine, thin-hq]
---

- Pivoted `standalone-factory` todos (`factory-local-engine`, `factory-queue-import-endpoint`, `sf-local-mode-cli`) so local Factory owns execution by default with no `--local` split-brain, and added `hq-thin-bridge-sync-and-outbox`.
- Added `universal-engine` todo chain built on updated `sf-gitlab-provider` (PR metadata return + remote auto-detect).
  - `sf-forge-andon-issue-and-draft-pr` opens WIP Draft PR/MR and `sf:andon` Issue on escalation and persists forge URLs.
  - `sf-repo-agnostic-lines-and-init-detect` embeds repo-agnostic lines and auto-detects stack, CI, runners, and forge into 1-file repo config.
  - `sf-universal-role-md-and-guards` embeds repo-agnostic `ROLE.md` built-ins with live `sf operator done` guard validation and `lessons.md` injection.
  - `sf-telemetry-and-oee-stats` and `sf-model-escalation-and-budget-caps` add per-job cost, PR merge tracking, `sf stats`, retry model escalation, and spend caps.
- Updated `web-incidents-module` to surface linked forge `issueUrl` and `draftPrUrl`, and paused `web-push-andon-alerts`, `web-tokens-module`, and `web-request-cache`.
