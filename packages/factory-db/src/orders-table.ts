import { asc } from 'drizzle-orm';
import type {
  OrderId,
  ProjectId,
  StationId,
  TodoId,
  CellId,
} from '@repo/factory-core/ids';
import type { AndonReason, JobKind } from '@repo/factory-core/order/events';
import type { Next } from '@repo/factory-core/order/next';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { BoardStatus, Holder } from '@repo/factory-core/order/status';
import type { Priority } from '@repo/factory-core/order/state';
import type { FactoryDatabase } from './db';
import { type NewOrderRecord, type OrderRecord, orders } from './schema';

/** One `orders` row as read (STORAGE §4). JSON columns are strings, booleans are 0/1. */
export type OrderRow = OrderRecord;

/** One `orders` row as written. */
export type NewOrderRow = NewOrderRecord;

/** The row a projection is stored as. Pure serialisation: no fold, no domain decision. */
export const orderRowOf = (projection: OrderProjection): OrderRow => ({
  orderId: projection.orderId,
  projectId: projection.projectId,
  todoId: projection.todoId,
  title: projection.title,
  line: projection.line,
  priority: projection.priority,
  dependsOn: JSON.stringify(projection.dependsOn),
  lastSeq: projection.lastSeq,
  status: projection.status,
  holder: projection.holder,
  nextKind: projection.nextKind,
  jobKind: projection.jobKind,
  runner: projection.runner,
  requiredCapabilities: JSON.stringify(projection.requiredCapabilities),
  stationId: projection.stationId,
  stationIndex: projection.stationIndex,
  progressed: projection.progressed ? 1 : 0,
  resumed: projection.resumed ? 1 : 0,
  lastCellId: projection.lastCellId,
  avoidCells: JSON.stringify(
    projection.avoidCells.map((avoid) => ({
      cellId: avoid.cellId,
      until: avoid.until,
    })),
  ),
  andonReason: projection.andonReason,
  prUrl: projection.prUrl,
  prState: projection.prState,
  createdAt: projection.createdAt,
  updatedAt: projection.updatedAt,
});

/** The projection a row holds. The inverse of `orderRowOf`. */
export const projectionOfRow = (row: OrderRow): OrderProjection => {
  const avoid = JSON.parse(row.avoidCells) as {
    cellId: string;
    until: number;
  }[];
  return {
    orderId: row.orderId as OrderId,
    projectId: row.projectId as ProjectId,
    todoId: row.todoId as TodoId,
    title: row.title,
    line: row.line,
    priority: row.priority as Priority,
    dependsOn: JSON.parse(row.dependsOn) as OrderId[],
    lastSeq: row.lastSeq,
    status: row.status as BoardStatus,
    holder: row.holder as Holder['kind'],
    nextKind: row.nextKind as Next['kind'],
    jobKind: row.jobKind as JobKind | null,
    runner: row.runner,
    requiredCapabilities: JSON.parse(row.requiredCapabilities) as string[],
    stationId: row.stationId as StationId | null,
    stationIndex: row.stationIndex,
    progressed: row.progressed === 1,
    resumed: row.resumed === 1,
    lastCellId: row.lastCellId as CellId | null,
    avoidCells: avoid.map((entry) => ({
      cellId: entry.cellId as CellId,
      until: entry.until,
    })),
    andonReason: row.andonReason as AndonReason | null,
    prUrl: row.prUrl,
    prState: row.prState as OrderProjection['prState'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

/** Writes a projection row: insert, or replace the row of the same order (STORAGE §3 step 4). */
export const upsertOrder = (
  db: FactoryDatabase,
  projection: OrderProjection,
): void => {
  const row = orderRowOf(projection);
  // The conflicting row has the same order id, so setting it again changes nothing.
  db.insert(orders)
    .values(row)
    .onConflictDoUpdate({ target: orders.orderId, set: row })
    .run();
};

/** Every `orders` row as a projection, sorted by order id. */
export const loadOrders = (db: FactoryDatabase): OrderProjection[] =>
  db
    .select()
    .from(orders)
    .orderBy(asc(orders.orderId))
    .all()
    .map(projectionOfRow);
