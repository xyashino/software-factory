---
scope: factory/cell
summary: Pass workspace_failed stage, detail and log tail to Mechanic
why: Mechanic must diagnose the real root cause, not blindly resume
date: 2026-11-16
tags: [cell, mechanic, workspace, andon, incident, prompt]
---

- `WorkOrderState.workspaceFailures` records `stage`, `detail` and `logBlob` from each `workspace_failed` event, next to `cellId`, `jobId` and `at`.
- The workspace Andon (row 4) names the count, then the latest `stage` and `detail`, capped at 512 characters. Only the latest failure goes on the incident.
- The log is never stored in events or in `andon.detail`: it is a blob ref (`logBlob`) read at render time, because of the 4 KiB free-text cap and the machine-independence check.
- The Cell reads the log blob when it renders the Mechanic prompt and appends its last 2 KiB (`tailOf`). A blob that cannot be read leaves the prompt without a tail and does not fail the job.
- `mechanicSchema.incident.workspaceFailure` is optional, so Andons that are not workspace failures keep their current shape.
