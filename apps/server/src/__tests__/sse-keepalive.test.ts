import { describe, expect, it } from 'vitest';
import type { Runtime } from '@repo/factory-runtime/composition';
import { SSE_KEEPALIVE, streamResponse } from '../socket/serve';

/**
 * The SSE keepalive (PROTOCOL §3.1): a quiet feed still sends a comment line, so the TCP listener's idle
 * timeout never drops a live stream, and no event is lost or reordered around a keepalive.
 */

/** A feed of the given steps: each step waits, then yields its event; then the feed waits for abort. */
const scriptedFeed = (steps: { waitMs: number; globalSeq: number }[]) =>
  async function* (_after: number, signal?: AbortSignal) {
    for (const step of steps) {
      await new Promise((resolve) => setTimeout(resolve, step.waitMs));
      yield { globalSeq: step.globalSeq, event: { type: 'Scripted' } };
    }
    await new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => resolve());
    });
  };

const runtimeWith = (feed: ReturnType<typeof scriptedFeed>): Runtime =>
  ({ feed }) as unknown as Runtime;

/** Reads chunks until `done` says to stop, and returns them as text. */
const readUntil = async (
  body: ReadableStream<Uint8Array>,
  done: (chunks: string[]) => boolean,
): Promise<string[]> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  while (!done(chunks)) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(decoder.decode(next.value));
  }
  await reader.cancel();
  return chunks;
};

describe('the SSE keepalive', () => {
  it('sends a keepalive comment while the feed is quiet', async () => {
    const controller = new AbortController();
    const request = new Request('http://factory.test/v1/stream?after=0', {
      signal: controller.signal,
    });
    const response = streamResponse(runtimeWith(scriptedFeed([])), request, 5);

    const chunks = await readUntil(response.body!, (seen) => seen.length >= 2);
    controller.abort();

    expect(chunks.slice(0, 2)).toEqual([SSE_KEEPALIVE, SSE_KEEPALIVE]);
  });

  it('delivers an event after keepalives, in order, with its globalSeq as id', async () => {
    const controller = new AbortController();
    const request = new Request('http://factory.test/v1/stream?after=0', {
      signal: controller.signal,
    });
    const response = streamResponse(
      runtimeWith(scriptedFeed([{ waitMs: 40, globalSeq: 7 }])),
      request,
      5,
    );

    const chunks = await readUntil(response.body!, (seen) =>
      seen.some((chunk) => chunk.startsWith('id: ')),
    );
    controller.abort();

    const event = chunks.at(-1) ?? '';
    expect(chunks.slice(0, -1).every((chunk) => chunk === SSE_KEEPALIVE)).toBe(
      true,
    );
    expect(event.startsWith('id: 7\ndata: {"globalSeq":7')).toBe(true);
  });
});
