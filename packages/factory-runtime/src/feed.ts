import type { StoredEvent } from '@repo/factory-core/order/events';
import type { Notifier } from './notifier';
import type { RuntimePorts } from './ports';

/** Events read per page of the feed. */
const PAGE = 200;

/**
 * The event feed from a global position (PROTOCOL §3.1): every stored event after `afterGlobalSeq`,
 * in order, then each new commit as it lands. A commit wakes the feed at once; otherwise it reads
 * again every `feedPollMs`. The generator ends when `signal` aborts.
 */
export const feedFrom = async function* (
  ports: Pick<RuntimePorts, 'feed' | 'config'>,
  notifier: Notifier,
  afterGlobalSeq: number,
  signal?: AbortSignal,
): AsyncGenerator<StoredEvent> {
  let cursor = afterGlobalSeq;
  while (!signal?.aborted) {
    const rows = await ports.feed.feed(cursor, PAGE);
    for (const row of rows) {
      if (signal?.aborted) return;
      cursor = row.globalSeq;
      yield row;
    }
    if (rows.length === 0) {
      await notifier.waitFor(ports.config.feedPollMs, signal);
    }
  }
};
