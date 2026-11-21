import { Hono } from 'hono';
import type { BusEvent } from '../../../application/ports/event-bus.port';
import type { AppEnv } from '../types';

const encoder = new TextEncoder();

const frameOf = (event: BusEvent): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

export const streamRoute = new Hono<AppEnv>().get('/', (c) => {
  const { eventBus, signal } = c.get('transport');
  let unsubscribe: () => void = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = eventBus.subscribe((event) =>
        controller.enqueue(frameOf(event)),
      );
      controller.enqueue(encoder.encode(': connected\n\n'));
      signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          controller.close();
        },
        { once: true },
      );
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
});
