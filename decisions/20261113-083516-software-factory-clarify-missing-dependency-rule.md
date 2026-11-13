---
scope: software-factory
summary: Keep absent todo dependency as satisfied, no code change
why: pickTodo already treats a missing todos file as satisfied; the statusById variant would unblock unparseable deps
date: 2026-11-13
tags: [supervisor, dependencies]
---

- `isDelivered` in `pick-todo.ts` already returns true when `todos/<dep>.md` is absent from the listing
- Existing tests cover absent file satisfied, `status: todo` blocks, delivered record after file removal
- Spec asked to test `statusById` membership; rejected, it holds only parsed files
- With `statusById`, an unparseable dependency file would count as satisfied and break its blocking test
- Kept the `todoFiles` check; no source or test change
