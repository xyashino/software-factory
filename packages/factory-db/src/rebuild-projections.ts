import type { Database } from 'bun:sqlite';
import type { OrderId } from '@repo/factory-core/ids';
import { evolve } from '@repo/factory-core/order/evolve';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { upsertOrder } from './orders-table';
import { feedRows, type SqliteEventStore } from './sqlite-event-store';

/** Events read per page while rebuilding. */
const PAGE = 500;

/** What the caller knows about a row beyond its folded state (STORAGE §6). */
export interface RowMeta {
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Turns a folded Work order into its `orders` row. The caller supplies it (the store never
 * computes a projection): it is the core projection function, bound to whatever it needs.
 */
export type ProjectRow = (
  state: WorkOrderState,
  meta: RowMeta,
) => OrderProjection;

interface Folding {
  state: WorkOrderState;
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
}

/** Folds one page of events into `foldings`, in global order (which keeps each order's seq order). */
const foldPage = (
  foldings: Map<OrderId, Folding>,
  page: ReturnType<typeof feedRows>,
): void => {
  for (const stored of page) {
    const previous = foldings.get(stored.orderId);
    foldings.set(stored.orderId, {
      state: evolve(previous?.state, stored),
      lastSeq: stored.seq,
      createdAt: previous?.createdAt ?? stored.at,
      updatedAt: stored.at,
    });
  }
};

const rebuildOn = (db: Database, project: ProjectRow): number => {
  db.exec('DELETE FROM orders');
  const foldings = new Map<OrderId, Folding>();
  let afterGlobalSeq = 0;
  let page = feedRows(db, afterGlobalSeq, PAGE);
  while (page.length > 0) {
    foldPage(foldings, page);
    afterGlobalSeq = page[page.length - 1]?.globalSeq ?? afterGlobalSeq;
    page = feedRows(db, afterGlobalSeq, PAGE);
  }
  for (const folding of foldings.values()) {
    upsertOrder(
      db,
      project(folding.state, {
        lastSeq: folding.lastSeq,
        createdAt: folding.createdAt,
        updatedAt: folding.updatedAt,
      }),
    );
  }
  return foldings.size;
};

/**
 * Rebuilds the `orders` table from `events` (STORAGE §6): truncates it, folds every Work order in
 * global order, and writes one row per order, all in one write transaction. Returns the number of
 * rows written. Rebuilding twice gives the same table.
 */
export const rebuildProjections = (
  store: SqliteEventStore,
  project: ProjectRow,
): Promise<number> => store.exclusive((db) => rebuildOn(db, project));
