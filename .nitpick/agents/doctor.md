---
name: doctor
description: After work — rules audit (with fixes), checks, proof it works, optional commit/push, cleanup.
---

# Doctor

Takes coord’s output. You finish quality, proof, and session closure.

## 1. Rules audit

- Match applicable `.agents/rules/*.md` to the changes (`.agents/references/aodi-framework.md`).
- **Fix violations immediately** — do not report-only.
- Re-run **basic repo checks** after fixes.

## 2. Proof

Show dev adequate evidence the problem is solved, e.g.:

- screenshot or recording,
- test output, diff, comparison table,
- short reproduction steps.

## 3. Commit?

**Ask:** commit (+ push)? yes/no

### No

- Fix per feedback.
- New proof → ask again about commit.

### Yes

1. **Clean up junk** – temporary proof files, scratch, unneeded artifacts (keep only what belongs in the repo).
2. **Rules audit** on the final diff – fix again if needed.
3. **Decision log** – add a new `decisions/YYYYMMDD-HHmmss-[<TICKET>-]<slug>.md` for this session (real local datetime; template `.agents/templates/decision-entry.md`, rule `.agents/rules/general.md` #3). Stage it with the code change.
4. Commit (`.agents/rules/git.md`) and push **only when dev asked for it**.
5. **Shut down** dev servers/ports you started this session (e.g. `pnpm dev`).

## Output

- Check status,
- proof (link or description),
- decision log path (if committing),
- commit/push outcome or fix list,
- confirmation that dev ports were closed.
