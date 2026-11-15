import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellId, ProjectId } from '@repo/factory-core/ids';
import { seedProject } from '@repo/factory-runtime/seed';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { runAdminCommand } from '../admin-command';
import { startSocketListener, type SocketListener } from '../socket/listener';
import { socketFactoryClient } from '../socket/client';
import { orderRequest } from '../testing/order-request';

const PROJECT = 'software-factory' as ProjectId;
const CELL = '01J0000000000000000000000W' as CellId;
const REPO = 'https://example.test/software-factory.git';

let root: string;
let opened: OpenedRuntime[] = [];
let listener: SocketListener | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-admin-'));
});

afterEach(async () => {
  await listener?.stop();
  listener = undefined;
  for (const runtime of opened.splice(0)) runtime.close();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/** A data directory seeded with the project, as the registry has it. */
const dataDirWithProject = (name: string): string => {
  const dataDir = join(root, name);
  mkdirSync(dataDir);
  seedProject(dataDir, { projectId: PROJECT, repoUrl: REPO });
  return dataDir;
};

const open = (dataDir: string): OpenedRuntime => {
  const runtime = openRuntime({ dataDir });
  opened.push(runtime);
  return runtime;
};

/** Captures what the command prints, as the JSON it writes on stdout. */
const printedJson = (spy: ReturnType<typeof vi.spyOn>): unknown =>
  JSON.parse(String(spy.mock.calls.at(-1)?.[0]));

describe('factory-server admin', () => {
  it('refuses to run while a server holds the data directory', async () => {
    const dataDir = dataDirWithProject('busy');
    open(dataDir);
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const code = await runAdminCommand(
      ['backup', join(root, 'backup.db')],
      dataDir,
    );

    expect(code).toBe(1);
    expect(String(errors.mock.calls[0]?.[0])).toMatch(
      /held by a running factory-server/,
    );
  });

  it('writes a backup that opens with the same orders', async () => {
    const dataDir = dataDirWithProject('source');
    const runtime = open(dataDir);
    await runtime.runtime.call(
      'createOrder',
      orderRequest(PROJECT, 'add-login'),
    );
    runtime.close();
    opened = [];
    const file = join(root, 'backup.db');
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runAdminCommand(['backup', file], dataDir);

    expect(code).toBe(0);
    expect(printedJson(logs)).toMatchObject({ counts: { events: 1 } });
    const copy = new Database(file, { readonly: true });
    try {
      expect(
        copy.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM orders').get(),
      ).toEqual({ n: 1 });
    } finally {
      copy.close();
    }
  });

  it('imports an export into an empty directory and expires the lease it finds', async () => {
    const source = dataDirWithProject('exporter');
    const running = open(source);
    await running.runtime.call(
      'createOrder',
      orderRequest(PROJECT, 'add-login'),
    );
    await running.runtime.call('hello', {
      cellId: CELL,
      version: '0.1.0',
      projects: [PROJECT],
      runners: ['claude'],
      capabilities: [],
    });
    const claimed = await running.runtime.call('claim', {
      cellId: CELL,
      waitMs: 0,
    });
    expect(claimed.job).not.toBeNull();
    running.close();
    opened = [];
    const file = join(root, 'export.tar');
    await runAdminCommand(['export', file], source);
    const target = join(root, 'target');
    mkdirSync(target);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const code = await runAdminCommand(['import', file], target);

    expect(code).toBe(0);
    expect(printedJson(logs)).toMatchObject({
      counts: { projects: 1, events: expect.any(Number) },
      expired: [claimed.job?.orderId],
    });
    const check = open(target);
    const [row] = (await check.runtime.call('board', {})).orders;
    expect(row?.holder).not.toBe('cell');
  });

  it('backs up a running server through its socket route', async () => {
    const dataDir = dataDirWithProject('served');
    const runtime = open(dataDir);
    await runtime.runtime.start();
    const socketPath = join(dataDir, 'factory.sock');
    listener = startSocketListener({ runtime: runtime.runtime, socketPath });
    const client = socketFactoryClient({ socketPath });
    const file = join(root, 'served-backup.db');

    const response = await client.call('adminBackup', { file });

    expect(response).toEqual({
      file,
      counts: { globalSeq: 0, projects: 1, events: 0, blobs: 0 },
    });
  });
});
