import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { StoredEvent } from '@repo/factory-core/order/events';

/** How long one feed request is held when nothing is new (PROTOCOL §3.1, 25 s like claims). */
export const FEED_WAIT_MS = 25_000;

/**
 * The position after the newest stored event, read without waiting. The feed is read a page at a
 * time, so a long history costs a few calls once, when a follower starts.
 */
export const latestSeq = async (client: FactoryClient): Promise<number> => {
  let cursor = 0;
  for (;;) {
    const page = await client.call('supervisorEvents', {
      afterGlobalSeq: cursor,
      waitMs: 0,
    });
    if (page.events.length === 0) return cursor;
    cursor = page.nextSeq;
  }
};

/**
 * Waits for the next stored events after `cursor` (a long-poll of up to 25 s per call, repeated until
 * something arrives). Returns the events and the new cursor. The caller decides what to print.
 */
export const nextEvents = async (
  client: FactoryClient,
  cursor: number,
): Promise<{ events: StoredEvent[]; cursor: number }> => {
  for (;;) {
    const batch = await client.call('supervisorEvents', {
      afterGlobalSeq: cursor,
      waitMs: FEED_WAIT_MS,
    });
    if (batch.events.length > 0) {
      return { events: batch.events, cursor: batch.nextSeq };
    }
    cursor = batch.nextSeq;
  }
};
