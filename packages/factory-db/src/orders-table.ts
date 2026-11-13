import type { Database } from 'bun:sqlite';
import type {
  OrderId,
  ProjectId,
  StationId,
  TodoId,
  WorkerId,
} from '@repo/factory-core/ids';
import type { AndonReason, JobKind } from '@repo/factory-core/order/events';
import type { Next } from '@repo/factory-core/order/next';
import type { BoardStatus, Holder } from '@repo/factory-core/order/status';
import type { OrderProjection } from '@repo/factory-core/order/projection';
import type { Priority } from '@repo/factory-core/order/state';

/** One `orders` row (STORAGE §4). JSON columns are strings, booleans are 0/1. */
export interface OrderRow {
  order_id: string;
  project_id: string;
  todo_id: string;
  title: string;
  line: string;
  priority: string;
  depends_on: string;
  last_seq: number;
  status: string;
  holder: string;
  next_kind: string;
  job_kind: string | null;
  runner: string | null;
  required_capabilities: string;
  station_id: string | null;
  station_index: number | null;
  progressed: number;
  resumed: number;
  last_cell_id: string | null;
  avoid_cells: string;
  andon_reason: string | null;
  pr_url: string | null;
  pr_state: string | null;
  created_at: number;
  updated_at: number;
}

/** The column list in the order `orderRowValues` returns them. */
export const ORDER_COLUMNS = [
  'order_id',
  'project_id',
  'todo_id',
  'title',
  'line',
  'priority',
  'depends_on',
  'last_seq',
  'status',
  'holder',
  'next_kind',
  'job_kind',
  'runner',
  'required_capabilities',
  'station_id',
  'station_index',
  'progressed',
  'resumed',
  'last_cell_id',
  'avoid_cells',
  'andon_reason',
  'pr_url',
  'pr_state',
  'created_at',
  'updated_at',
] as const;

/** The row a projection is stored as. Pure serialisation: no fold, no domain decision. */
export const orderRowOf = (projection: OrderProjection): OrderRow => ({
  order_id: projection.orderId,
  project_id: projection.projectId,
  todo_id: projection.todoId,
  title: projection.title,
  line: projection.line,
  priority: projection.priority,
  depends_on: JSON.stringify(projection.dependsOn),
  last_seq: projection.lastSeq,
  status: projection.status,
  holder: projection.holder,
  next_kind: projection.nextKind,
  job_kind: projection.jobKind,
  runner: projection.runner,
  required_capabilities: JSON.stringify(projection.requiredCapabilities),
  station_id: projection.stationId,
  station_index: projection.stationIndex,
  progressed: projection.progressed ? 1 : 0,
  resumed: projection.resumed ? 1 : 0,
  last_cell_id: projection.lastWorkerId,
  avoid_cells: JSON.stringify(
    projection.avoidWorkers.map((avoid) => ({
      cellId: avoid.workerId,
      until: avoid.until,
    })),
  ),
  andon_reason: projection.andonReason,
  pr_url: projection.prUrl,
  pr_state: projection.prState,
  created_at: projection.createdAt,
  updated_at: projection.updatedAt,
});

/** The positional values of `ORDER_COLUMNS` for one row. */
export const orderRowValues = (row: OrderRow): (string | number | null)[] =>
  ORDER_COLUMNS.map((column) => row[column]);

/** Writes a projection row: insert, or replace the row of the same order (STORAGE §3 step 4). */
export const upsertOrder = (
  db: Database,
  projection: OrderProjection,
): void => {
  const placeholders = ORDER_COLUMNS.map(() => '?').join(', ');
  const updates = ORDER_COLUMNS.filter((column) => column !== 'order_id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  db.run(
    `INSERT INTO orders (${ORDER_COLUMNS.join(', ')}) VALUES (${placeholders}) ON CONFLICT(order_id) DO UPDATE SET ${updates}`,
    orderRowValues(orderRowOf(projection)),
  );
};

/** Every `orders` row as a projection, sorted by order id. */
export const loadOrders = (db: Database): OrderProjection[] =>
  db
    .query<OrderRow, []>('SELECT * FROM orders ORDER BY order_id')
    .all()
    .map(projectionOfRow);

/** The projection a row holds. The inverse of `orderRowOf`. */
export const projectionOfRow = (row: OrderRow): OrderProjection => {
  const avoid = JSON.parse(row.avoid_cells) as {
    cellId: string;
    until: number;
  }[];
  return {
    orderId: row.order_id as OrderId,
    projectId: row.project_id as ProjectId,
    todoId: row.todo_id as TodoId,
    title: row.title,
    line: row.line,
    priority: row.priority as Priority,
    dependsOn: JSON.parse(row.depends_on) as OrderId[],
    lastSeq: row.last_seq,
    status: row.status as BoardStatus,
    holder: row.holder as Holder['kind'],
    nextKind: row.next_kind as Next['kind'],
    jobKind: row.job_kind as JobKind | null,
    runner: row.runner,
    requiredCapabilities: JSON.parse(row.required_capabilities) as string[],
    stationId: row.station_id as StationId | null,
    stationIndex: row.station_index,
    progressed: row.progressed === 1,
    resumed: row.resumed === 1,
    lastWorkerId: row.last_cell_id as WorkerId | null,
    avoidWorkers: avoid.map((entry) => ({
      workerId: entry.cellId as WorkerId,
      until: entry.until,
    })),
    andonReason: row.andon_reason as AndonReason | null,
    prUrl: row.pr_url,
    prState: row.pr_state as OrderProjection['prState'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};
