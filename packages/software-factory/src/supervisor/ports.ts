import type { Definitions } from '../definitions/types';
import type { ClockPort } from '../ports/clock.port';
import type { GithubPort } from '../ports/github.port';
import type { GitPort } from '../ports/git.port';
import type { HerdrPort } from '../ports/herdr.port';
import type { ProcessPort } from '../ports/process.port';
import type { StorePort } from '../ports/store.port';
import type { SystemPort } from '../ports/system.port';

/** One line of the PR checklist. `passed` comes from the step's latest result, never assumed. */
export interface VerificationItem {
  label: string;
  passed: boolean;
}

/** What a delivery needs from the finished task, resolved by the supervisor from the event log. */
export interface DeliveryInput {
  taskId: string;
  to: 'new-pr';
  worktree: string;
  branch: string;
  /** absolute path of the `commit.txt` artifact */
  commitFile: string;
  /** absolute path of the `report.md` artifact */
  reportFile: string;
  /** absolute path of the todo file in the main checkout */
  todoPath: string;
  /** the todo path relative to the repo root, e.g. `todos/<name>.md` */
  todoRelPath: string;
  /** the PR checklist, rendered from the gate and agent results */
  verification: VerificationItem[];
}

export interface BlockedDeliveryInput {
  taskId: string;
  worktree: string;
  branch: string;
  reason: string;
  detail: string;
}

/** The delivery step (commit, push, PR). The supervisor calls it; `supervisor/deliver.ts` implements it. */
export interface Deliverer {
  deliver(input: DeliveryInput): Promise<{ prUrl: string }>;
  /** Preserves uncommitted work as a draft `[BLOCKED]` PR. */
  publishBlocked(input: BlockedDeliveryInput): Promise<{ prUrl: string }>;
}

/** Herdr workspace ids per task, so a restarted supervisor reuses them. */
export interface WorkspaceRegistry {
  get(taskId: string): string | undefined;
  set(taskId: string, workspaceId: string): void;
  delete(taskId: string): void;
}

/** Everything the supervisor touches. Tests pass fakes; the CLI passes adapters. */
export interface SupervisorPorts {
  /** the main checkout: owns `.factory`, `.evidences` and `.worktrees` */
  root: string;
  definitions: Definitions;
  store: StorePort;
  herdr: HerdrPort;
  git: GitPort;
  system: SystemPort;
  /** starts headless agent processes */
  process: ProcessPort;
  clock: ClockPort;
  deliverer: Deliverer;
  github: GithubPort;
  workspaces: WorkspaceRegistry;
  /** PATH for agent panes: the package bin first */
  pathEnv: string;
  /** the base branch every task worktree starts from */
  baseRef: string;
}
