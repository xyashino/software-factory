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

/** How long a poll that came back empty and early waits before the next one (no server to hold it). */
export const FEED_IDLE_PAUSE_MS = 1_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the next stored events after `cursor` (a long-poll of up to 25 s per call, repeated until
 * something arrives). Returns the events and the new cursor. The caller decides what to print.
 *
 * With no server socket the poll is answered at once and empty; then the wait is a pause between
 * polls, so the loop does not spin on the one-shot server.
 */
export const nextEvents = async (
  client: FactoryClient,
  cursor: number,
): Promise<{ events: StoredEvent[]; cursor: number }> => {
  for (;;) {
    const startedAt = Date.now();
    const batch = await client.call('supervisorEvents', {
      afterGlobalSeq: cursor,
      waitMs: FEED_WAIT_MS,
    });
    if (batch.events.length > 0) {
      return { events: batch.events, cursor: batch.nextSeq };
    }
    cursor = batch.nextSeq;
    if (Date.now() - startedAt < FEED_WAIT_MS / 2) {
      await sleep(FEED_IDLE_PAUSE_MS);
    }
  }
};
