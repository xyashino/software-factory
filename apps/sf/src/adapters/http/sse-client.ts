import type { SseFrame } from '../../application/ports/hq.port';

const FRAME_END = '\n\n';

const parseBlock = (block: string): SseFrame | undefined => {
  let event = 'message';
  let id: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    const colon = line.indexOf(':');
    if (line.length === 0 || colon === 0) {
      continue;
    }
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') {
      event = value;
    } else if (field === 'id') {
      id = value;
    } else if (field === 'data') {
      data.push(value);
    }
  }
  return data.length === 0 ? undefined : { event, id, data: data.join('\n') };
};

export const readSseFrames = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      for (
        let end = buffer.indexOf(FRAME_END);
        end !== -1;
        end = buffer.indexOf(FRAME_END)
      ) {
        const frame = parseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + FRAME_END.length);
        if (frame !== undefined) {
          yield frame;
        }
      }
    }
  } finally {
    await reader.cancel();
  }
};
