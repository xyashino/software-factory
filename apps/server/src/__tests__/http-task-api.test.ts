import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import type {
  OrderId,
  PlanId,
  ProjectId,
  StationId,
} from '@repo/factory-core/ids';
import { fakePrState } from '@repo/factory-core/testing';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { pinnableLine } from '@repo/factory-runtime/task-api';
import { gitMirror } from '../adapters/git-mirror';
import { createHttpApp } from '../http/app';
import { createFixtureRepo, todoFile } from './e2e/fixture-repo';

/**
 * The task API (PROTOCOL §3.3): Work orders and Order Plans are created over HTTP with a pinned Line in the
 * body. The server holds no repo definition for them: the repo below has no `.factory/` and no todo to intake.
 */

const PROJECT = 'software-factory' as ProjectId;
const PROJECT_BASE = 'main';
const SUPERVISOR_NAME = 'dev';
const LINE_NAME = 'api-line';
const COMMAND_PREFIX = 'task-api';
const PR_URL = 'https://github.com/example/repo/pull/7';

let root: string;
let opened: OpenedRuntime | undefined;
let app: ReturnType<typeof createHttpApp>;
let commandSeq = 0;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'factory-http-task-api-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  // A git commit needs one file; a `done` todo is not intake's to create, and the API never reads todos.
  const repo = await createFixtureRepo(join(root, 'repo'), {
    placeholder: todoFile({ title: 'Placeholder', status: 'done' }),
  });
  seedProject(dataDir, { projectId: PROJECT, repoUrl: repo });
  opened = openRuntime({
    dataDir,
    git: gitMirror({ mirrorsDir: join(dataDir, 'mirrors') }),
    prState: fakePrState(),
    config: { intakePollMs: 0, prPollMs: 0 },
  });
  await opened.runtime.start();
  app = createHttpApp(opened.runtime);
});

afterEach(() => {
  opened?.close();
  rmSync(root, { recursive: true, force: true });
});

interface Sent {
  method?: string;
  path: string;
  token?: string;
  json?: unknown;
}

const send = async (sent: Sent): Promise<Response> => {
  const headers: Record<string, string> = {};
  if (sent.token) headers.authorization = `Bearer ${sent.token}`;
  let body: BodyInit | undefined;
  if (sent.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(sent.json);
  }
  return await app.request(sent.path, {
    method: sent.method ?? 'GET',
    headers,
    body,
  });
};

const supervisorToken = async (): Promise<string> =>
  (await opened!.runtime.remote.createSupervisorToken(SUPERVISOR_NAME)).token;

const nextCommandId = (): string => {
  commandSeq += 1;
  return `${COMMAND_PREFIX}-${commandSeq}`;
};

/** A Line the caller supplies: one operator station, hashed the way `factory-definitions` hashes a snapshot. */
const lineSnapshot = (name = LINE_NAME): LineSnapshot => {
  const body = {
    snapshotVersion: 1 as const,
    name,
    stations: [
      {
        id: 'build' as StationId,
        kind: 'operator' as const,
        runner: 'claude',
        requires: [],
        maxRestarts: 0,
        maxLostRestarts: 0,
        verdict: false,
        artifacts: [],
      },
    ],
  };
  return pinnableLine(body);
};

const orderBody = (todoId: string) => ({
  commandId: nextCommandId(),
  projectId: PROJECT,
  todoId,
  title: `Add ${todoId}`,
  type: 'feat',
  body: `# Add ${todoId}\n\nUsers can ${todoId}.\n`,
  line: lineSnapshot(),
  priority: 'medium',
  dependsOn: [],
});

const orderId = (todoId: string): OrderId => `${PROJECT}:${todoId}` as OrderId;

const planIdOf = (slug: string): PlanId => `${PROJECT}:plan:${slug}` as PlanId;

const memberBody = (todoId: string) => ({
  todoId,
  title: `Add ${todoId}`,
  type: 'feat',
  body: `# Add ${todoId}\n`,
  line: lineSnapshot(),
  priority: 'high',
});

describe('POST /v1/orders', () => {
  it('creates a Work order that pins the Line it was sent, and the board shows it', async () => {
    const token = await supervisorToken();
    const body = orderBody('sign-in');

    const created = await send({
      method: 'POST',
      path: '/v1/orders',
      token,
      json: body,
    });

    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ orderId: orderId('sign-in') });
    const detail = await send({
      path: `/v1/orders/${encodeURIComponent(orderId('sign-in'))}`,
      token,
    });
    const { order, events } = (await detail.json()) as {
      order: { line: string; title: string; baseBranch: string };
      events: { event: { type: string; line?: { hash: string } } }[];
    };
    expect(order.line).toBe(LINE_NAME);
    expect(order.title).toBe('Add sign-in');
    expect(order.baseBranch).toBe(PROJECT_BASE);
    const orderCreated = events.find(
      (stored) => stored.event.type === 'order_created',
    );
    expect(orderCreated?.event.line?.hash).toBe(body.line.hash);
  });

  it('answers a replayed commandId with the same response and creates no second event', async () => {
    const token = await supervisorToken();
    const body = orderBody('replayed');
    const first = await send({
      method: 'POST',
      path: '/v1/orders',
      token,
      json: body,
    });
    const eventsBefore = await send({
      path: `/v1/orders/${encodeURIComponent(orderId('replayed'))}`,
      token,
    });

    const replay = await send({
      method: 'POST',
      path: '/v1/orders',
      token,
      json: body,
    });

    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    const eventsAfter = await send({
      path: `/v1/orders/${encodeURIComponent(orderId('replayed'))}`,
      token,
    });
    const before = (await eventsBefore.json()) as { events: unknown[] };
    const after = (await eventsAfter.json()) as { events: unknown[] };
    expect(after.events).toHaveLength(before.events.length);
  });

  it('refuses a Line whose hash does not match its snapshot', async () => {
    const token = await supervisorToken();
    const body = orderBody('tampered');
    const tampered = {
      ...body,
      line: { ...body.line, hash: `sha256:${'0'.repeat(64)}` },
    };

    const response = await send({
      method: 'POST',
      path: '/v1/orders',
      token,
      json: tampered,
    });

    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({ code: 'invalid' });
  });

  it('refuses a body with no Line', async () => {
    const token = await supervisorToken();
    const withoutLine: Record<string, unknown> = { ...orderBody('no-line') };
    delete withoutLine.line;

    const response = await send({
      method: 'POST',
      path: '/v1/orders',
      token,
      json: withoutLine,
    });

    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({ code: 'invalid' });
  });

  it('refuses a caller without a supervisor credential', async () => {
    const response = await send({
      method: 'POST',
      path: '/v1/orders',
      json: orderBody('anonymous'),
    });

    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({ code: 'unauthorized' });
  });
});

describe('POST /v1/plans', () => {
  it('creates an Order Plan whose members run in the order given, each after the one before', async () => {
    const token = await supervisorToken();
    const members = ['first', 'second', 'third'].map(memberBody);

    const response = await send({
      method: 'POST',
      path: '/v1/plans',
      token,
      json: {
        commandId: nextCommandId(),
        projectId: PROJECT,
        slug: 'auth',
        members,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ planId: planIdOf('auth') });
    const detail = await send({
      path: `/v1/plans/${encodeURIComponent(planIdOf('auth'))}`,
      token,
    });
    const plan = (await detail.json()) as {
      members: { todoId: string; after: OrderId | null }[];
    };
    expect(plan.members.map((member) => member.todoId)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(plan.members[0]?.after).toBeNull();
    expect(plan.members[1]?.after).toBe(orderId('first'));
    expect(plan.members[2]?.after).toBe(orderId('second'));
  });

  it('refuses a plan that lists one todo twice', async () => {
    const token = await supervisorToken();
    const member = memberBody('twice');

    const response = await send({
      method: 'POST',
      path: '/v1/plans',
      token,
      json: {
        commandId: nextCommandId(),
        projectId: PROJECT,
        slug: 'dup',
        members: [member, member],
      },
    });

    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({ code: 'invalid' });
  });
});

describe('POST /v1/orders/:id/pr-state', () => {
  it('refuses a PR state for a Work order that has no PR yet', async () => {
    const token = await supervisorToken();
    await send({
      method: 'POST',
      path: '/v1/orders',
      token,
      json: orderBody('no-pr-yet'),
    });

    const response = await send({
      method: 'POST',
      path: `/v1/orders/${encodeURIComponent(orderId('no-pr-yet'))}/pr-state`,
      token,
      json: { commandId: nextCommandId(), prUrl: PR_URL, state: 'merged' },
    });

    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({
      code: 'precondition',
      detail: 'the Work order has no PR',
    });
  });

  it('refuses a PR state for an Order Plan that has no PR yet', async () => {
    const token = await supervisorToken();
    await send({
      method: 'POST',
      path: '/v1/plans',
      token,
      json: {
        commandId: nextCommandId(),
        projectId: PROJECT,
        slug: 'no-pr',
        members: [memberBody('only')],
      },
    });

    const response = await send({
      method: 'POST',
      path: `/v1/plans/${encodeURIComponent(planIdOf('no-pr'))}/pr-state`,
      token,
      json: { commandId: nextCommandId(), prUrl: PR_URL, state: 'closed' },
    });

    expect(response.status).not.toBe(200);
    expect(await response.json()).toMatchObject({
      code: 'precondition',
      detail: 'the plan has no PR',
    });
  });

  it('refuses a PR state for an order that was never created', async () => {
    const token = await supervisorToken();

    const response = await send({
      method: 'POST',
      path: `/v1/orders/${encodeURIComponent(orderId('ghost'))}/pr-state`,
      token,
      json: { commandId: nextCommandId(), prUrl: PR_URL, state: 'open' },
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not_found' });
  });
});
