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
import { gitMirror } from '../adapters/git-mirror';
import { startSocketListener, type SocketListener } from '../socket/listener';
import { socketFactoryClient } from '../socket/client';
import { createFixtureRepo, todoFile } from './e2e/fixture-repo';

const PROJECT = 'software-factory' as ProjectId;

let root: string;
let dataDir: string;
let opened: OpenedRuntime | undefined;
let listener: SocketListener | undefined;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-stream-'));
  dataDir = join(root, 'data');
  mkdirSync(dataDir);
  const repo = await createFixtureRepo(join(root, 'repo'), {
    'todo-a': todoFile({ title: 'A', v2: true }),
    'todo-b': todoFile({ title: 'B', v2: true }),
    'todo-c': todoFile({ title: 'C', v2: true }),
  });
  seedProject(dataDir, { projectId: PROJECT, repoUrl: repo });
  opened = openRuntime({
    dataDir,
    git: gitMirror({ mirrorsDir: join(dataDir, 'mirrors') }),
    config: { feedPollMs: 20, intakePollMs: 0, prPollMs: 0 },
  });
  listener = startSocketListener({
    runtime: opened.runtime,
    socketPath: join(dataDir, 'factory.sock'),
  });
});

afterEach(async () => {
  await listener?.stop();
  listener = undefined;
  opened?.close();
  opened = undefined;
  rmSync(root, { recursive: true, force: true });
});

const client = () =>
  socketFactoryClient({ socketPath: join(dataDir, 'factory.sock') });

/** Reads the feed until `done` says stop, then aborts it. */
const read = async (
  after: number,
  done: (seen: StoredEvent[]) => boolean,
): Promise<StoredEvent[]> => {
  const abort = new AbortController();
  const seen: StoredEvent[] = [];
  for await (const stored of client().stream(after, abort.signal)) {
    seen.push(stored);
    if (done(seen)) abort.abort();
  }
  return seen;
};

describe('event feed over the socket', () => {
  it('starts after the global position it is given', async () => {
    await client().call('intakeSync', {});

    const seen = await read(1, (events) => events.length === 2);

    expect(seen.map((stored) => stored.globalSeq)).toEqual([2, 3]);
  });

  it('ends at once when the consumer aborts before any event', async () => {
    const abort = new AbortController();
    abort.abort();

    const seen: StoredEvent[] = [];
    for await (const stored of client().stream(0, abort.signal)) {
      seen.push(stored);
    }

    expect(seen).toEqual([]);
  });

  it('refuses a feed position that is not a whole number', async () => {
    const response = await fetch('http://factory/v1/stream?after=nope', {
      unix: join(dataDir, 'factory.sock'),
    } as RequestInit);

    expect(response.status).toBe(422);
  });
});
