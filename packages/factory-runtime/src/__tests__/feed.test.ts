import { describe, expect, it } from 'vitest';
import type { OrderId } from '@repo/factory-core/ids';
import { createOrder, flush, world } from './test-kit';

const seenBy = async (
  stream: AsyncIterable<{ globalSeq: number; orderId: OrderId }>,
  count: number,
  abort: AbortController,
): Promise<{ globalSeq: number; orderId: OrderId }[]> => {
  const seen: { globalSeq: number; orderId: OrderId }[] = [];
  for await (const stored of stream) {
    seen.push(stored);
    if (seen.length === count) abort.abort();
  }
  return seen;
};

describe('event feed', () => {
  it('streams stored events in global order', async () => {
    const w = world();
    const first = await createOrder(w, { todoId: 'first' });
    const second = await createOrder(w, { todoId: 'second' });
    const abort = new AbortController();

    const seen = await seenBy(w.runtime.feed(0, abort.signal), 2, abort);

    expect(seen.map((stored) => stored.orderId)).toEqual([first, second]);
    expect(seen.map((stored) => stored.globalSeq)).toEqual([1, 2]);
  });

  it('resumes after the last global position it was given', async () => {
    const w = world();
    await createOrder(w, { todoId: 'first' });
    const second = await createOrder(w, { todoId: 'second' });
    const abort = new AbortController();

    const seen = await seenBy(w.runtime.feed(1, abort.signal), 1, abort);

    expect(seen.map((stored) => stored.orderId)).toEqual([second]);
  });

  it('waits for a new commit and reports it without a timer', async () => {
    const w = world();
    const abort = new AbortController();
    const collected = seenBy(w.runtime.feed(0, abort.signal), 1, abort);
    await flush();

    const created = await createOrder(w, { todoId: 'late' });
    await flush();

    expect((await collected).map((stored) => stored.orderId)).toEqual([
      created,
    ]);
  });

  it('ends when the consumer aborts while it waits', async () => {
    const w = world();
    const abort = new AbortController();
    const stream = seenBy(w.runtime.feed(0, abort.signal), 5, abort);
    await flush();

    abort.abort();

    await expect(stream).resolves.toEqual([]);
  });
});
