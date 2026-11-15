import type { ProjectId } from '../ids';

/** One registered project: where its repository is and how many Work orders it runs at once. */
export interface ProjectRecord {
  projectId: ProjectId;
  repoUrl: string;
  baseBranch: string;
  maxRunning: number;
  /** When a dependency counts as done: its PR delivered, or merged (STORAGE §4). */
  depPolicy: 'delivered' | 'merged';
}

/**
 * What `set` may change (PROTOCOL §3.1). There is no `repoUrl`: mirrors and Cell checkouts would go
 * stale, so a project with another repository is removed and added again.
 */
export interface ProjectPatch {
  baseBranch?: string;
  maxRunning?: number;
  depPolicy?: 'delivered' | 'merged';
}

/** Why a store refused a write. The runtime maps each reason to a refusal (PROTOCOL §3.5). */
export type ProjectRefusal =
  'exists' | 'missing' | 'has_history' | 'base_branch_busy';

/** The answer of a registry write: done, or refused for one reason. Nothing was written when refused. */
export type ProjectStoreResult =
  { ok: true } | { ok: false; reason: ProjectRefusal };

/**
 * The `projects` table (STORAGE §4): mutable configuration, not an event stream. Writes assert the
 * writer lock. `remove` refuses a project with any Work order or event; `set` refuses a
 * `baseBranch` change while a Work order of the project is not terminal.
 */
export interface ProjectStore {
  list(): Promise<ProjectRecord[]>;
  /** Registers a project created at `createdAt`. `exists` when the id is taken. */
  add(project: ProjectRecord, createdAt: number): Promise<ProjectStoreResult>;
  /** Changes the given fields. `missing` when the project is unknown. */
  set(projectId: ProjectId, patch: ProjectPatch): Promise<ProjectStoreResult>;
  /** Deletes a project with no history. `missing` when the project is unknown. */
  remove(projectId: ProjectId): Promise<ProjectStoreResult>;
}
