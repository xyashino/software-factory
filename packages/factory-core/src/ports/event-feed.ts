import type { StoredEvent } from '../order/events';

/**
 * The event feed (`GET /v1/stream`): stored events in global order, after a position.
 * `factory status --watch` and `factory log -f` read it over the HTTP stream.
 */
export interface EventFeed {
  feed(afterGlobalSeq: number, limit: number): Promise<StoredEvent[]>;
}
