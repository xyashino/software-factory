# Feature: Delivery and GitHub

Implemented design spec. Turns an approved worktree into a PR, and runs the `review` workflow on PR feedback.

## Scope

- `deliver` action: commit, push, create or update the PR.
- `[BLOCKED]` PRs.
- `task.reviewThreads` input and the `review` workflow trigger.
- Cleanup.

## Port

```ts
interface GithubPort {
  findPr(branch: string): Promise<{ number: number; url: string; state: 'open' | 'closed' | 'merged' } | undefined>;
  createPr(input: { branch: string; base: string; title: string; body: string; draft: boolean }): Promise<{ url: string }>;
  commentPr(number: number, body: string): Promise<void>;
  unresolvedThreads(number: number): Promise<ReviewThread[]>;
}
```

Adapter shells out to `gh`. Port from `packages/factory/src/application/procedures/pr/*` and `step/review-threads.ts`, with their tests.

## Deliver (`new-pr`)

1. Append `delivery_started`.
2. Commit everything in the worktree with the `deliver.commit` artifact as the message (port `delivery-commit.ts`). Skip if there are no changes since the last commit.
3. Push the branch.
4. `findPr(branch)`; create one only if none exists (idempotent after a restart).
5. Title: first line of the commit message. Body: `formatPrBody` with the commit message, the `deliver.report` artifact and the decision entry added in the branch.
6. Append `delivered { prUrl }`; mark the todo delivered (port the todo status update); remove the worktree and snapshot refs; close the Herdr workspace.

Any failure → `delivery_failed`, then `blocked { reason: 'delivery_failed' }`. The worktree is kept.

## Deliver (`open-pr`)

Same, but the PR already exists: push to its branch and post a comment summarizing the round (port `publish-review-update.ts`).

## Blocked PR

When a task blocks after at least one `build` attempt completed and the branch has changes against the base, the supervisor opens a draft PR titled `[BLOCKED] <title>` with the block reason and the last feedback (port `publish-blocked-pr.procedure.ts`). It is recorded as `delivery_started { to: 'blocked-pr' }` / `delivered`, but the task stays `blocked`.

## Review workflow trigger

- On each idle tick (no active task), the supervisor checks delivered tasks with open PRs for unresolved threads (port `list-review-prs.procedure.ts`).
- One with threads starts a new run of the same task id with workflow `review`, on the PR's branch.
- `task.reviewThreads` is rendered as a markdown list of threads (file, line, author, body) and saved as an input artifact.

## Tests

- Port the existing PR delivery, integrity and review-thread tests.
- Restart after push but before PR creation → no second push, PR created once.
- Blocked task with no changes → no blocked PR.
