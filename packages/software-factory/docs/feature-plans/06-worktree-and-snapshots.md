# Feature: Worktree and Snapshots

Implemented design spec. Git operations owned by the supervisor.

## Scope

- Creating and removing the task worktree and branch.
- Snapshot refs and restore.
- Commit and push for delivery (used by feature 10).

## Port

```ts
interface GitPort {
  createWorktree(input: { path: string; branch: string; base: string }): Promise<void>;
  removeWorktree(path: string): Promise<void>;
  snapshot(input: { worktree: string; ref: string }): Promise<string>;   // returns commit sha
  restore(input: { worktree: string; ref: string }): Promise<void>;
  hasChanges(input: { worktree: string; base: string }): Promise<boolean>;
  commitAll(input: { worktree: string; message: string }): Promise<string>;
  push(input: { worktree: string; branch: string }): Promise<void>;
  remoteBranchExists(branch: string): Promise<boolean>;
}
```

Port from `packages/factory/src/adapters/git` and `step-worktree.procedure.ts`.

## Worktree

- Path: `.worktrees/<taskId>`.
- Branch: `<type>/<taskId>`, using the rules in `packages/factory/src/application/procedures/todo/branch.ts` (port it). Type comes from the todo frontmatter, default `feat`.
- Base: `origin/main`, fetched first.
- `review` workflow: check out the existing PR branch instead of creating one.
- After creation the supervisor runs `workflow.setup.exec` in it (`pnpm install --frozen-lockfile`).
- Removed after `delivered`. Kept when blocked, so a human can inspect it.

## Snapshots

Ref: `refs/software-factory/<taskId>/<attemptId>`.

```sh
export GIT_INDEX_FILE=$(mktemp)          # temporary index; the worktree's own index is untouched
git read-tree HEAD
git add -A                               # respects .gitignore, so node_modules is excluded
tree=$(git write-tree)
sha=$(git commit-tree "$tree" -p HEAD -m "factory snapshot <attemptId>")
git update-ref refs/software-factory/<taskId>/<attemptId> "$sha"
```

Restore (supervisor only, only before an infrastructure restart):

```sh
git read-tree --reset -u <ref>           # tracked files back to the snapshot
git clean -fd                            # untracked, non-ignored files removed
git reset --soft <HEAD at snapshot>      # undo commits the agent made, keep the tree
```

`HEAD` at snapshot time is the snapshot commit's parent.

Snapshot refs are deleted after delivery: `git for-each-ref refs/software-factory/<taskId> --format='delete %(refname)' | git update-ref --stdin`.

## Tests

Against a real temporary git repository (fast, no network):
- Snapshot leaves `git status` and the index unchanged.
- Restore brings back modified, deleted and added files exactly; ignored files survive.
- Restore after the agent committed returns HEAD to the parent.
- Branch naming: port the existing branch tests.
