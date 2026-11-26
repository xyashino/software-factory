# `sf operator` Client (`apps/sf`)

Thin loopback CLI used by Operator and Mechanic agents inside a Job to report back to their Cell.

- Terms: [glossary](../README.md#glossary)
- Server effects: [hq.md §4](./hq.md#4-agent-reporting-operator--mechanic-via-cell)
- Wire contract: `apps/sf/src/contracts/operator.contract.ts`

## 1. Client Rules

- **Thin client**: Parse verb/flags, read named file (`--feedback`, `--handover`, `--report`, `-` for stdin), send one `POST /` JSON `{ verb, ...fields, token }` to `$FACTORY_OPERATOR_URL` with `$FACTORY_CYCLE_TOKEN`, print reply.
- **No domain logic**: Never reads `.factory/`, never decides state transitions, never retries automatically.
- **Secret safety**: Never writes `token` to disk, logs, or stdout.

## 2. Callers & Commands

| Role | Runs for | Verbs |
| :--- | :--- | :--- |
| **Operator** | Station job (`run_operator`) | `done`, `verdict pass`, `verdict fail`, `block`, `context` |
| **Mechanic** | Incident triage job (`mechanic`) | `read`, `incident` |

### Operator Verbs

| Command | Options | Request Fields (`operator.contract.ts`) | Meaning |
| :--- | :--- | :--- | :--- |
| `done` | none | `verb: 'done'`, `token` | Station finished |
| `verdict pass` | none | `verb: 'verdict'`, `outcome: 'pass'`, `token` | Review station passes |
| `verdict fail` | `--feedback <file>` | `verb: 'verdict'`, `outcome: 'fail'`, `feedback`, `token` | Review station fails (`feedback` required on `fail`) |
| `block` | `--reason "<why>"`, `--handover <file>` | `verb: 'block'`, `reason`, `handover`, `token` | Stop station; opens `operator_blocked` incident |
| `context` | none | `verb: 'context'`, `token` | Print Job inputs and outputs (read-only) |

### Mechanic Verbs

| Command | Options | Request Fields (`operator.contract.ts`) | Meaning |
| :--- | :--- | :--- | :--- |
| `read` | none | `verb: 'read'`, `token` | Print incident, step states, `.cell/` files and logs |
| `incident` | `--action <retry_step\|restart_from_step\|restart_from_scratch\|escalate\|cancel>`, `--step <step-id>`, `--diagnosis "<what>"`, `--outcome "<tried>"`, `--report <file>` | `verb: 'incident'`, `action`, `step`, `diagnosis`, `outcome`, `report`, `token` | Record and apply incident resolution (`step` required when `action` is `restart_from_step`) |

Report file sections: `## What happened`, `## What he tried`, `## Potential fix`.

## 3. Responsibility Split

| Check | CLI (`sf operator`) | Cell Loopback | HQ Server |
| :--- | :--- | :--- | :--- |
| Known `verb`, required flags (`reason`, `feedback`, `report`, `action`, `step`), readable file `path` | yes | | |
| `token` matches active Job; `verb` allowed for role; local `requiredFiles` and git state | | yes | |
| Transition valid for Job state, step kind, incident reason, non-empty `report`, real `step`, `epoch` fence | | | yes |

## 4. Exit Codes & Replies

| Exit Code | Meaning |
| :--- | :--- |
| `0` | Cell replied `200`. Prints `ok: true` |
| `1` | Refused (`400`, `401`, `409`, `500`). Prints `code: message` from reply |
| `2` | Bad arguments, missing env var, or unreadable file `path`. Sends nothing |
| `3` | Endpoint unreachable or malformed reply |
