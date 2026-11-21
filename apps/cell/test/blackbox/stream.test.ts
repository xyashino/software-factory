import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createTestApp, postJson, type TestApp } from '../support/test-app';

const REPO = '/work/app';

type Reader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
};

const openStream = async (
  app: TestApp,
  signal?: AbortSignal,
): Promise<Reader> => {
  const response = await app.request('/api/v1/stream', { signal });
  const reader = (
    response.body as ReadableStream<Uint8Array> | null
  )?.getReader();
  if (reader === undefined) throw new Error('stream has no body');
  return reader as Reader;
};

const readUntil = async (reader: Reader, text: string): Promise<string> => {
  const decoder = new TextDecoder();
  let seen = '';
  while (!seen.includes(text)) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += decoder.decode(value);
  }
  return seen;
};

describe('cell event stream', () => {
  it('sends an event for each cell that starts and stops', async () => {
    const { app, repoInspector } = createTestApp();
    repoInspector.addRepo(REPO);
    await postJson(app, '/api/v1/factories', {
      name: 'local',
      url: 'http://127.0.0.1:7070',
      joinToken: 'join-secret',
    });
    const reader = await openStream(app);

    await postJson(app, '/api/v1/cells', { repoRoot: REPO, count: 1 });
    await postJson(app, `/api/v1/cells/${hostname()}/stop`, {});

    const received = await readUntil(reader, 'cell.stopped');
    expect(received).toContain('"kind":"cell.started"');
    expect(received).toContain('"kind":"cell.stopping"');
    expect(received).toContain('"kind":"cell.stopped"');
    await reader.cancel();
  });

  it('closes the stream and stops delivering once the client aborts', async () => {
    const { app } = createTestApp();
    const controller = new AbortController();
    const reader = await openStream(app, controller.signal);

    controller.abort();

    let done = false;
    while (!done) done = (await reader.read()).done;
    expect(done).toBe(true);
  });
});
