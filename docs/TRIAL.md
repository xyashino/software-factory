# Trial runbook: v1 and v2 side by side (ROADMAP M9)

One week, non-critical todos, one repository. v1 and v2 never take the same todo.

## 1. How the split works

- A todo with `factory: v2` in its frontmatter belongs to v2. v1's `pick-todo.ts` skips it.
- v2 intake takes only those todos while `FACTORY_V2_ONLY` is `1` (the default, PROTOCOL §5.1).
- Every other todo stays with v1. Nothing else changes for v1.

## 2. Mark a trial todo

```yaml
---
status: todo
priority: low
workflow: standard
factory: v2
---
```

- Pick non-critical todos only. Add the field before the todo reaches `main`; v1 may pick it first.
- Never add `factory: v2` to a todo v1 already runs. Finish or cancel it first.
- `depends_on` across the split works by todo status: a v2 todo may wait on a v1 todo and the reverse.
- To hand a todo back to v1, cancel its Work order (`factory cancel <orderId>`), then remove the field.

## 3. Start

1. Leave `FACTORY_V2_ONLY` unset (or `1`). Start `factory-server` and a Cell.
2. `factory sync`, then `factory status`: only `factory: v2` todos appear as Work orders.
3. v1 keeps running as before; `sf status` must not list the trial todos.

## 4. Watch (daily)

- No todo in both boards: compare `factory status` with the v1 task list.
- No lost Work order: every trial todo has a Work order or a diagnostic.
- No duplicate: one Work order per todo id, one PR per Work order.
- Andons: each one is resumed with `factory resume <id>` and the Work order goes on.
- Delivery: PRs open against the right base and the PR poll reaches `merged`.
- Restart once mid-Work-order: `factory-server` comes back and loses nothing.
- Board parity: for the same kind of todo, v2 reaches the same stations and verdicts as v1.

## 5. Exit criteria

All hold at the end of the week:

- No lost or duplicated Work order.
- Every Andon resumed successfully.
- Board parity with v1.

## 6. After the trial (the Supervisor, not this runbook)

- Set `FACTORY_V2_ONLY=0` so v2 takes every todo; freeze v1; point the `sf` scripts at `factory`.
- If a criterion fails, stop the trial: cancel the open Work orders and remove `factory: v2` from their todos.
