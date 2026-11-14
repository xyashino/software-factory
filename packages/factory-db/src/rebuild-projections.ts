import type { OrderId, PlanId } from '@repo/factory-core/ids';
import { evolve } from '@repo/factory-core/order/evolve';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { evolvePlan } from '@repo/factory-core/plan/evolve';
import type { PlanState } from '@repo/factory-core/plan/state';
import type { ProjectionOf, RowMeta } from '@repo/factory-core/ports/archive';
import type { FactoryDatabase } from './db';
import { upsertOrder } from './orders-table';
import { upsertPlan } from './plans-table';
import { orders, plans } from './schema';
import { feedRows, type SqliteEventStore } from './sqlite-event-store';

/** Events read per page while rebuilding. */
const PAGE = 500;

/** A stream folded so far: its state, the last seq seen, and the times of its first and last event. */
interface Folding<S> {
  state: S;
  lastSeq: number;
  createdAt: number;
  updatedAt: number;
}

type Page = ReturnType<typeof feedRows>;

/**
 * Folds one page of events of either kind in global order, which keeps each stream in seq order.
 * A `planId` envelope is a plan event; anything else is a Work order event.
 */
const foldPage = (
  orderFoldings: Map<OrderId, Folding<WorkOrderState>>,
  planFoldings: Map<PlanId, Folding<PlanState>>,
  page: Page,
): void => {
  for (const stored of page) {
    if ('planId' in stored) {
      const previous = planFoldings.get(stored.planId);
      planFoldings.set(stored.planId, {
        state: evolvePlan(previous?.state, stored),
        lastSeq: stored.seq,
        createdAt: previous?.createdAt ?? stored.at,
        updatedAt: stored.at,
      });
      continue;
    }
    const previous = orderFoldings.get(stored.orderId);
    orderFoldings.set(stored.orderId, {
      state: evolve(previous?.state, stored),
      lastSeq: stored.seq,
      createdAt: previous?.createdAt ?? stored.at,
      updatedAt: stored.at,
    });
  }
};

/**
 * Rebuilds `orders` and `plans` from `events` on one open connection (STORAGE §6): truncates both,
 * folds every stream in global order, and writes one row per stream. Returns the number of Work
 * order rows, the count the admin operation has always reported.
 */
export const rebuildOn = (
  db: FactoryDatabase,
  project: ProjectionOf,
): number => {
  db.delete(orders).run();
  db.delete(plans).run();
  const orderFoldings = new Map<OrderId, Folding<WorkOrderState>>();
  const planFoldings = new Map<PlanId, Folding<PlanState>>();
  let afterGlobalSeq = 0;
  let page = feedRows(db, afterGlobalSeq, PAGE);
  while (page.length > 0) {
    foldPage(orderFoldings, planFoldings, page);
    afterGlobalSeq = page[page.length - 1]?.globalSeq ?? afterGlobalSeq;
    page = feedRows(db, afterGlobalSeq, PAGE);
  }
  for (const folding of orderFoldings.values()) {
    upsertOrder(db, project.order(folding.state, metaOf(folding)));
  }
  for (const folding of planFoldings.values()) {
    upsertPlan(db, project.plan(folding.state, metaOf(folding)));
  }
  return orderFoldings.size;
};

const metaOf = <S>(folding: Folding<S>): RowMeta => ({
  lastSeq: folding.lastSeq,
  createdAt: folding.createdAt,
  updatedAt: folding.updatedAt,
});

/**
 * Rebuilds the projections from `events` (STORAGE §6). The store never computes a projection: the
 * caller passes the core functions. Rebuilding twice gives the same tables.
 */
export const rebuildProjections = (
  store: SqliteEventStore,
  project: ProjectionOf,
): Promise<number> => store.exclusive((db) => rebuildOn(db, project));
