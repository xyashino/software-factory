import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FactoryImportReply } from '@repo/factory-contracts/queue.contract';
import type { FactoryCredential } from '@repo/factory-contracts/status.contract';
import { startFakeHq, type FakeHq } from './support/fake-hq';
import {
  PROJECT_ID,
  bearer,
  callFactory,
  callLocal,
  createHarness,
  readJson,
  repoWithoutConfig,
  writeTodoFile,
  type Harness,
} from './support/harness';

interface OrderList {
  items: { orderId: string; state: string }[];
}

interface ErrorReply {
  code: number;
  type: string;
  message: string;
}

const SESSION_TOKEN = 'session-token-1';
const CALLER_TOKEN = 'supervisor-token-1';
const IMPORT_PATH = '/queue/import';

const todoOf = (slug: string, extra = ''): string =>
  `---\nline: feature\ntype: feat\n${extra}---\n\n# ${slug}: Task ${slug}\n\nDo it.\n`;

const harnesses: Harness[] = [];
const fakes: FakeHq[] = [];

const standalone = (): Harness => {
  const harness = createHarness();
  harnesses.push(harness);
  return harness;
};

const credentialOf = (url: string): FactoryCredential => ({
  url,
  factoryId: 'factory-1',
  sessionToken: SESSION_TOKEN,
});

const connectedTo = async (hq: FakeHq): Promise<Harness> => {
  const harness = createHarness({ credential: credentialOf(hq.url) });
  harnesses.push(harness);
  await harness.app.tick();
  return harness;
};

const fakeHq = (options: {
  accepts: boolean;
  rejectImport?: boolean;
}): FakeHq => {
  const hq = startFakeHq(options);
  fakes.push(hq);
  return hq;
};

const importOf = (
  harness: Harness,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Response> =>
  callFactory(
    harness,
    'POST',
    IMPORT_PATH,
    { repoRoot: harness.repoRoot, ...body },
    headers,
  );

const queuedOrders = async (harness: Harness): Promise<OrderList> =>
  readJson<OrderList>(
    await callLocal(
      harness,
      'GET',
      `/api/v1/work-orders?projectId=${PROJECT_ID}`,
    ),
  );

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    void harness.app.stop();
  }
  for (const hq of fakes.splice(0)) {
    hq.stop();
  }
});

describe('standalone factory queue import', () => {
  it('imports todo files into the local queue when local is true', async () => {
    const harness = standalone();
    writeTodoFile(harness.repoRoot, 'alpha-task.md', todoOf('alpha-task'));

    const response = await importOf(harness, { local: true });
    const reply = await readJson<FactoryImportReply>(response);
    const orders = await queuedOrders(harness);

    expect(response.status).toBe(200);
    expect(reply.created).toBe(1);
    expect(reply.sent).toEqual(['alpha-task.md']);
    expect(orders.items.map((order) => order.state)).toEqual(['queued']);
  });

  it('refuses local false with 409 when not connected to HQ', async () => {
    const harness = standalone();
    writeTodoFile(harness.repoRoot, 'alpha-task.md', todoOf('alpha-task'));

    const response = await importOf(harness, { local: false });
    const error = await readJson<ErrorReply>(response);

    expect(response.status).toBe(409);
    expect(error.message).toBe(
      'factory not connected to HQ: pass --local or run "sf factory connect"',
    );
  });

  it('previews counts without creating work orders when dryRun is true', async () => {
    const harness = standalone();
    writeTodoFile(harness.repoRoot, 'alpha-task.md', todoOf('alpha-task'));

    const reply = await readJson<FactoryImportReply>(
      await importOf(harness, { local: true, dryRun: true }),
    );
    const orders = await queuedOrders(harness);

    expect(reply.mode).toBe('dry_run');
    expect(reply.sent).toEqual(['alpha-task.md']);
    expect(reply.created).toBe(0);
    expect(orders.items).toEqual([]);
  });

  it('skips a todo file without a line with reason no line', async () => {
    const harness = standalone();
    writeTodoFile(
      harness.repoRoot,
      'no-line.md',
      '---\ntype: feat\n---\n\n# no-line: Task\n',
    );

    const reply = await readJson<FactoryImportReply>(
      await importOf(harness, { local: true, dryRun: true }),
    );

    expect(reply.sent).toEqual([]);
    expect(reply.skipped).toEqual([
      { filename: 'no-line.md', reason: 'no line' },
    ]);
  });

  it('imports work orders as paused and leaves the todo file on disk unchanged', async () => {
    const harness = standalone();
    const text = todoOf('alpha-task', 'status: queued\n');
    writeTodoFile(harness.repoRoot, 'alpha-task.md', text);

    const reply = await readJson<FactoryImportReply>(
      await importOf(harness, { local: true, paused: true }),
    );
    const orders = await queuedOrders(harness);
    const onDisk = readFileSync(
      join(harness.repoRoot, 'todos', 'alpha-task.md'),
      'utf8',
    );

    expect(reply.paused).toBe(1);
    expect(orders.items.map((order) => order.state)).toEqual(['paused']);
    expect(onDisk).toBe(text);
  });

  it('answers 400 when the repo has no factory config', async () => {
    const harness = standalone();

    const response = await callFactory(harness, 'POST', IMPORT_PATH, {
      repoRoot: repoWithoutConfig(),
      local: true,
    });

    expect(response.status).toBe(400);
  });
});

describe('connected factory queue import', () => {
  it('refuses local true with 409 while connected to HQ', async () => {
    const hq = fakeHq({ accepts: true });
    const harness = await connectedTo(hq);
    writeTodoFile(harness.repoRoot, 'alpha-task.md', todoOf('alpha-task'));

    const response = await importOf(harness, { local: true });

    expect(response.status).toBe(409);
    expect(hq.imports).toEqual([]);
  });

  it('forwards local false to HQ with the caller bearer and echoes its counts', async () => {
    const hq = fakeHq({ accepts: true });
    const harness = await connectedTo(hq);
    writeTodoFile(harness.repoRoot, 'alpha-task.md', todoOf('alpha-task'));

    const response = await importOf(
      harness,
      { local: false },
      bearer(CALLER_TOKEN),
    );
    const reply = await readJson<FactoryImportReply>(response);

    expect(response.status).toBe(200);
    expect(hq.imports).toHaveLength(1);
    expect(hq.imports[0]?.authorization).toBe(`Bearer ${CALLER_TOKEN}`);
    expect(hq.imports[0]?.body.files.map((file) => file.filename)).toEqual([
      'alpha-task.md',
    ]);
    expect(reply.created).toBe(1);
  });

  it('answers 503 when HQ cannot be reached', async () => {
    const harness = createHarness({
      credential: credentialOf('http://127.0.0.1:1'),
    });
    harnesses.push(harness);
    await harness.app.tick();

    const response = await importOf(
      harness,
      { local: false },
      bearer(CALLER_TOKEN),
    );

    expect(response.status).toBe(503);
  });

  it('answers 401 when forwarding to HQ without a bearer token', async () => {
    const hq = fakeHq({ accepts: true });
    const harness = await connectedTo(hq);

    const response = await importOf(harness, { local: false });

    expect(response.status).toBe(401);
    expect(hq.imports).toEqual([]);
  });

  it('echoes HQ validation errors in the reply', async () => {
    const hq = fakeHq({ accepts: true, rejectImport: true });
    const harness = await connectedTo(hq);
    writeTodoFile(harness.repoRoot, 'bad.md', todoOf('bad'));

    const reply = await readJson<FactoryImportReply>(
      await importOf(harness, { local: false }, bearer(CALLER_TOKEN)),
    );

    expect(reply.created).toBe(0);
    expect(reply.errors).toEqual([
      { filename: 'bad.md', message: 'depends_on unknown' },
    ]);
  });
});
