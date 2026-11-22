---
scope: factory/cell
summary: Only the builder station commits, other stations discard changes
why: One commit per build attempt; other stations must not commit or push
date: 2026-11-22
tags: [cell, git, checkpoint]
---

- Committing station = station id named by `deliver.commit` (`build.commit` -> `build`). Only it runs commit + push to `factory/<slug>`.
- `parseLine` validates `deliver.commit`: unknown station throws `invalid deliver.commit`. `LineStation.commits` marks the one station.
- Line without `deliver.commit`: no station commits.
- Other stations (operators, inspections, mechanic, incident): no commit, no push.
- Non-committing station with dirty tree: discard, log `discard <paths>` on its row. `commitSha` = current HEAD (HQ requires a sha; `headCommitSha` unchanged).
- Discard = `git reset --hard HEAD` + `git clean -fd`. Not `git checkout -- .` (keeps staged changes). Never `-x`, so ignored `.cell/` survives.
- Git port gains `resetHard`, `clean`, `discardChanges`, `hasCommit` (`cat-file -e <sha>^{commit}`).
- `checkpointStation` takes `commits` and returns `{ commitSha, discarded }`.
- Builder retry: new attempt commits on top of previous build commit (HEAD).
- Tests: real-git discard unit; black-box checkpoint (commit + push, retry stacks, no commit/push, discard); parse-line; run-job quality gate discards and logs.
- Deviation from task text: `reset --hard` instead of `checkout -- .`, reason above.
