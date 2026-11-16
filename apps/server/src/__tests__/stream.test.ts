import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { seedProject } from '@repo/factory-runtime/seed';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import type { HttpListener } from '../http/listener';
import { orderRequest } from '../testing/order-request';
import {
  feedOf,
  httpClient,
  listenLocal,
  LOCAL_TEST_TOKEN,
} from '../testing/local-http';

const PROJECT = 'software-factory' as ProjectId;

let root: string;
let dataDir: string;
let opened: OpenedRuntime | undefined;
let listener: HttpListener | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-stream-'));
  dataDir = join(root, 'data');
  mkdirSync(dataDir);
  seedProject(dataDir, {
    projectId: PROJECT,
    repoUrl: 'https://example.test/software-factory.git',
  });
  opened = openRuntime({
    dataDir,
    config: { feedPollMs: 20 },
  });
  listener = listenLocal(opened.runtime);
});

afterEach(async () => {
  await listener?.stop();
  listener = undefined;
  opened?.close();
  opened = undefined;
  rmSync(root, { recursive: true, force: true });
});

const url = (): string => listener!.url;
const client = () => httpClient(url(), LOCAL_TEST_TOKEN);

/** Reads the feed until `done` says stop, then aborts it. */
const read = async (
  after: number,
  done: (seen: StoredEvent[]) => boolean,
): Promise<StoredEvent[]> => {
  const abort = new AbortController();
  const seen: StoredEvent[] = [];
  for await (const stored of feedOf(url(), after, abort.signal)) {
    seen.push(stored);
    if (done(seen)) abort.abort();
  }
  return seen;
};

describe('event feed over HTTP', () => {
  it('starts after the global position it is given', async () => {
    for (const todo of ['todo-a', 'todo-b', 'todo-c']) {
      await client().call('createOrder', orderRequest(PROJECT, todo));
    }

    const seen = await read(1, (events) => events.length === 2);

    expect(seen.map((stored) => stored.globalSeq)).toEqual([2, 3]);
  });

  it('ends at once when the consumer aborts before any event', async () => {
    const abort = new AbortController();
    abort.abort();

    const seen: StoredEvent[] = [];
    for await (const stored of feedOf(url(), 0, abort.signal)) {
      seen.push(stored);
    }

    expect(seen).toEqual([]);
  });

  it('refuses a feed position that is not a whole number', async () => {
    const response = await fetch(`${url()}/v1/stream?after=nope`, {
      headers: { authorization: `Bearer ${LOCAL_TEST_TOKEN}` },
    });

    expect(response.status).toBe(422);
  });
});
