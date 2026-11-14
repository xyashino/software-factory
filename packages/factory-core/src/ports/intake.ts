import type { ProjectId, TodoId } from '../ids';

/**
 * One row of the `intake` table (STORAGE §4): the last todo file the runtime saw for one todo, its
 * content hash, the commit it was read at, and the diagnostic that stops it becoming a Work order.
 */
export interface IntakeRecord {
  projectId: ProjectId;
  todoId: TodoId;
  /** `sha256:<hex>` of the normalised todo file (todo-hash). */
  contentHash: string;
  /** The base-branch commit the file was read at. */
  seenCommit: string;
  /** Why the todo is not a Work order (unparseable frontmatter, reused id...), or null. */
  diagnostic: string | null;
}

/** The intake rows, per project. Writes need the writer lock; the SQLite adapter asserts it. */
export interface IntakeStore {
  get(projectId: ProjectId, todoId: TodoId): Promise<IntakeRecord | undefined>;
  forProject(projectId: ProjectId): Promise<IntakeRecord[]>;
  upsert(record: IntakeRecord): Promise<void>;
}
