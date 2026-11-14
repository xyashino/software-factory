import type { OrderProjection } from '../order/projection';
import type { PlanProjection } from '../plan/projection';

/**
 * The read side of the `orders` projection (STORAGE §4). The runtime reads the board and the queue
 * through this port and never touches SQLite; the adapter reads the rows as they are stored.
 */
export interface ProjectionReader {
  /** Every Work order row, sorted by order id. */
  orders(): Promise<OrderProjection[]>;
  /** Every Order Plan row, sorted by plan id. */
  plans(): Promise<PlanProjection[]>;
}
