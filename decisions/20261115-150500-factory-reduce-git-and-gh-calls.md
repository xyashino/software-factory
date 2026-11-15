---
scope: factory
summary: Intake and PR polling batch git and gh calls
why: Per-file cat-file, a gh pr view per PR and an intake upsert per todo on every idle poll cost a process or a write each time
date: 2026-11-15
tags: [perf, intake, pr-poll, git, gh]
---

- The git mirror reads all todo files of a commit with one `git cat-file --batch` process, cut by byte size so multibyte text stays whole; an empty todos folder starts no cat-file process.
- Intake writes a todo's row only when its commit, content hash or diagnostic differs from the stored row, so an idle sync writes nothing. The row is the cache key; no state is kept in memory.
- A new base-branch commit moves every row's `seen_commit`, so every row is written once per commit even when its todo did not change.
- `PrStatePort.readMany` reads PR states with one `gh pr list --state all` per repository (at most four in flight); `gh pr view` only for a PR the list does not hold. A repository whose list fails is left out, and the next pass asks again.
- `pollPrStates` reads every open PR's state in one `readMany` call and submits only the states that changed, with the same command ids as before.
- The poll intervals (`FACTORY_INTAKE_POLL_MS`, `FACTORY_PR_POLL_MS`) were already tunable; their defaults are unchanged.
