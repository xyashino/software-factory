import type { StoredEvent } from '../order/events';

/**
 * The event feed (PROTOCOL §3.1, `GET /v1/stream`): stored events in global order, after a position.
 * `factory status --watch` and `factory log -f` read it through the socket.
 */
export interface EventFeed {
  feed(afterGlobalSeq: number, limit: number): Promise<StoredEvent[]>;
}
