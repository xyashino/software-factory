# `factory-server` — run locally and test a todo

Run an isolated server with its own database, then push one todo through the queue. Use a temp dir so no real factory state is touched.

## 1. Start

```bash
cd apps/factory-server
export FACTORY_DATA_DIR="$(mktemp -d /tmp/factory-test-XXXX)"
export FACTORY_DB_PATH="$FACTORY_DATA_DIR/factory.db"
export FACTORY_PORT=17070
bun src/index.ts
```

Port 7070 is the default and may already be used by a running instance. Pick a free port or stop the other one first.

On start the server writes `$FACTORY_DATA_DIR/web-demo.join` (mode `0600`). It is the join secret for the supervisor session below.

## 2. Get a supervisor session

```bash
B=http://127.0.0.1:17070/api/v1
JS=$(cat "$FACTORY_DATA_DIR/web-demo.join")
SESS=$(curl -s -X POST $B/tokens/join -H 'content-type: application/json' \
  -d "{\"joinSecret\":\"$JS\"}" | bun -e 'console.log((await new Response(Bun.stdin.stream()).json()).token)')
```

The session has `supervisor:read` and `supervisor:write`. Never print or log it.

## 3. Register the project

```bash
curl -s -X POST $B/projects -H "authorization: Bearer $SESS" -H 'content-type: application/json' \
  -d '{"projectId":"factory-test","repoUrl":"git@example.test:acme/factory-test.git","defaultBaseBranch":"main"}'
```

## 4. Import a todo

A todo is a markdown file with a frontmatter block and a `# <slug>: <title>` heading whose slug matches the filename.

```markdown
---
status: queued
priority: high
line: feature
type: feat
---

# add-hello-doc: Add hello doc

Write a short hello doc for the factory.
```

Always dry-run first, then apply with a `commandId` (required for `apply`):

```bash
curl -s -X POST $B/queue/import -H "authorization: Bearer $SESS" -H 'content-type: application/json' \
  --data-binary @dry.json          # {"projectId":"factory-test","mode":"dry_run","files":[{"filename":"add-hello-doc.md","markdown":"..."}]}
curl -s -X POST $B/queue/import -H "authorization: Bearer $SESS" -H 'content-type: application/json' \
  --data-binary @apply.json        # same body with "mode":"apply","commandId":"cmd-1"
```

Expected: `{"code":200,"mode":"apply","created":1,"updated":0,"skipped":0,"errors":[]}`.

## 5. Check the result

```bash
curl -s "$B/work-orders?projectId=factory-test" -H "authorization: Bearer $SESS"
curl -s "$B/queue/export?projectId=factory-test" -H "authorization: Bearer $SESS"
```

The work order is `orderId: factory-test:add-hello-doc`, `state: queued`, `lineName: feature`, `priority: high`. Export returns the same todo as `todos/add-hello-doc.md`.

## Error path

A file without frontmatter is rejected with `422` and the reason:

```json
{
  "code": 422,
  "type": "unprocessable-entity",
  "message": "Queue import rejected",
  "errors": [
    {
      "filename": "bad.md",
      "message": "file must start with a --- frontmatter block"
    }
  ]
}
```

## Stop

Stop the server with `Ctrl+C`, then remove the temp dir.

## Verified

Run on 2026-11-19 against a fresh temp DB: project create, join, dry-run and apply import, work-order list, export round-trip, and the `422` path. Unit and black-box suite: `pnpm test` (284 tests) passes.
