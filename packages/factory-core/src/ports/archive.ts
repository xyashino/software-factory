import type { WorkOrderState } from '../order/state';
import type { OrderProjection } from '../order/projection';
import type { PlanState } from '../plan/state';
import type { PlanProjection } from '../plan/projection';

/** The bookkeeping of a row beyond its folded state. */
export interface RowMeta {
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Folds a stream into its row: `order` for a Work order (`orders`), `plan` for an Order Plan
 * (`plans`). The caller binds the core projection functions and the `next` of each stream.
 */
export interface ProjectionOf {
  order(state: WorkOrderState, meta: RowMeta): OrderProjection;
  plan(state: PlanState, meta: RowMeta): PlanProjection;
}

/** What a backup or an export holds, counted, so the caller can report it. */
export interface ArchiveCounts {
  globalSeq: number;
  projects: number;
  events: number;
  blobs: number;
}

/**
 * Snapshot, export and import of the Factory's data. Every operation needs the writer
 * lock. The SQLite adapter lives in factory-db; tests use a fake.
 */
export interface ArchivePort {
  /** A consistent copy of the database file (`VACUUM INTO`). */
  backup(file: string): Promise<ArchiveCounts>;
  /** The portable export: manifest, projects, events in global order, every cited blob. */
  exportTo(file: string, exportedAt: number): Promise<ArchiveCounts>;
  /**
   * Reads an export into an empty database: projects, blobs and events unchanged, then rebuilds
   * the `orders` projection using `project`. Refuses any database that already holds data.
   */
  importFrom(
    file: string,
    project: ProjectionOf,
    importedAt: number,
  ): Promise<ArchiveCounts>;
  /** Rebuilds every `orders` row from the events; returns how many rows it wrote. */
  rebuildProjections(project: ProjectionOf): Promise<number>;
}
