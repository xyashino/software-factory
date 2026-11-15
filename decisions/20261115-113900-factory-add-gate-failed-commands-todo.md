---
scope: factory/trial
summary: Add todo to report only failed gate commands without raw output
why: Sending raw command output in inspection events and build retry prompts is brittle and unnecessary when the builder can re-run failed commands in its worktree
date: 2026-11-15
tags: [v2, trial, feature, gate, inspection, prompts]
---

- Add `todos/v2-gate-failed-commands-only.md` (`factory: v2`, `workflow: feature`, `depends_on: [v2-fix-inspection-tail-sanitization]`) to replace raw command output in `ReportInspection.tail` and `gate-feedback` prompts with a short list of failed commands and instructions to run and fix them locally in the worktree.
