import { describe, expect, it } from 'vitest';
import { readSseFrames } from '../../../../src/adapters/http/sse-client';

const bodyOf = (...chunks: string[]): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
};

const framesOf = async (body: ReadableStream<Uint8Array>) => {
  const frames = [];
  for await (const frame of readSseFrames(body)) {
    frames.push(frame);
  }
  return frames;
};

describe('sse client', () => {
  it('reads transition frames even when a frame is split across chunks', async () => {
    // Arrange
    const body = bodyOf(
      'event: transition\nid: 1\ndata: {"seq":1}\n',
      '\nevent: transition\nid: 2\ndata: {"seq":2}\n\n',
    );

    // Act
    const frames = await framesOf(body);

    // Assert
    expect(frames).toEqual([
      { event: 'transition', id: '1', data: '{"seq":1}' },
      { event: 'transition', id: '2', data: '{"seq":2}' },
    ]);
  });

  it('skips keepalive comments that carry no data', async () => {
    // Arrange
    const body = bodyOf(': keepalive\n\n', 'id: 7\ndata: {"seq":7}\n\n');

    // Act
    const frames = await framesOf(body);

    // Assert
    expect(frames.map((frame) => frame.id)).toEqual(['7']);
  });

  it('drops a frame that never ends with a blank line', async () => {
    // Arrange
    const body = bodyOf('id: 1\ndata: {"seq":1}\n\nid: 2\ndata: {"seq":2}\n');

    // Act
    const frames = await framesOf(body);

    // Assert
    expect(frames.map((frame) => frame.data)).toEqual(['{"seq":1}']);
  });
});
