---
scope: factory/cell
summary: Cell redacts machine-local values from tails and failure details
why: Server refuses machine-local free text, so a failed command sent a ZodError instead of its report
date: 2026-11-15
tags: [cell, tail, machine-local]
---

- `apps/cell/src/jobs/redact.ts` replaces machine-local tokens with `<redacted>`:
  - paths, `~/`, drive paths, `.local`/`.lan`/`.internal`/`localhost`, `host:port`, IPs, `pid=`, pane ids
  - then cuts the text to its limit and checks it again with `isMachineIndependentText`
  - a text that still fails becomes a fixed withheld message, so the guard always passes
- `tailOf` keeps the last 2 KiB, redacted. `errorText`, `tailOfRun`, and `reportFailed` in run-inspection, deliver, and plan cap their details at 500 chars, redacted.
- The full unredacted log stays in `logBlob`. The redaction only changes what goes on the wire.
- Tests: `apps/cell/src/__tests__/redact.test.ts` and `run-inspection.test.ts` cover each bad ending, a token split by the cut, and a crash message.
