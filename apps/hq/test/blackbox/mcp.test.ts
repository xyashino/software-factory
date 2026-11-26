import { describe, expect, it } from 'vitest';
import {
  VALID_TOKEN,
  createTestApp,
  grantingAuth,
  postJson,
  type TestApp,
} from '../support/test-app';

const AUTH = { authorization: `Bearer ${VALID_TOKEN}` };

const READ_TOOLS = [
  'get_work_order',
  'list_factories',
  'list_incidents',
  'list_order_plans',
  'list_projects',
  'list_work_orders',
];

const WRITE_TOOLS = [
  'import_todos',
  'resolve_incident',
  'run_queue_action',
  'transition_order_plan',
  'transition_work_order',
];

const readApp = () =>
  createTestApp({ auth: grantingAuth(['supervisor:read']) }).app;

const writeApp = () =>
  createTestApp({
    auth: grantingAuth(['supervisor:read', 'supervisor:write']),
  }).app;

const rpc = (app: TestApp, body: unknown, headers = {}) =>
  postJson(app, '/api/v1/mcp', body, { ...AUTH, ...headers });

const call = (app: TestApp, name: string, args: unknown) =>
  rpc(app, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });

const toolNames = async (app: TestApp): Promise<string[]> => {
  const response = await rpc(app, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  const body = (await response.json()) as {
    result: { tools: { name: string }[] };
  };
  return body.result.tools.map((tool) => tool.name).sort();
};

describe('MCP initialize', () => {
  it('answers with protocol version, server info and tools capability', async () => {
    const app = readApp();

    const response = await rpc(app, {
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: {},
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 'init',
      result: {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'hq' },
        capabilities: { tools: {} },
      },
    });
  });

  it('accepts the initialized notification with an empty 202', async () => {
    const app = readApp();

    const response = await rpc(app, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });
});

describe('MCP tools/list', () => {
  it('shows a read token only the six read tools', async () => {
    const app = readApp();

    const names = await toolNames(app);

    expect(names).toEqual(READ_TOOLS);
  });

  it('shows a write token all eleven tools', async () => {
    const app = writeApp();

    const names = await toolNames(app);

    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  });
});

describe('MCP tools/call', () => {
  it('lets a read token list projects', async () => {
    const app = readApp();

    const response = await call(app, 'list_projects', {});

    const body = (await response.json()) as {
      result: { isError: boolean; structuredContent: { projects: unknown[] } };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.projects).toEqual([]);
  });

  it('refuses a read token on a write tool with HTTP 403', async () => {
    const app = readApp();

    const response = await call(app, 'import_todos', {
      body: { projectId: 'factory', mode: 'dry_run', files: [] },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 403,
      type: 'forbidden',
    });
  });

  it('lets a write token run a dry-run import', async () => {
    const app = writeApp();
    await postJson(
      app,
      '/api/v1/projects',
      {
        projectId: 'factory',
        repoUrl: 'git@example.test:acme/factory.git',
        defaultBaseBranch: 'main',
      },
      AUTH,
    );

    const response = await call(app, 'import_todos', {
      body: { projectId: 'factory', mode: 'dry_run', files: [] },
    });

    const body = (await response.json()) as {
      result: {
        isError: boolean;
        structuredContent: { code: number; mode: string };
      };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent).toMatchObject({
      code: 200,
      mode: 'dry_run',
    });
  });

  it('rejects a missing required param with invalid params', async () => {
    const app = readApp();

    const response = await call(app, 'get_work_order', {});

    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602 },
    });
  });

  it('rejects a missing required query with invalid params', async () => {
    const app = readApp();

    const response = await call(app, 'list_work_orders', {});

    expect(await response.json()).toMatchObject({
      error: { code: -32602 },
    });
  });

  it('rejects an unknown tool name with invalid params', async () => {
    const app = readApp();

    const response = await call(app, 'drop_database', {});

    expect(await response.json()).toMatchObject({
      error: { code: -32602 },
    });
  });

  it('reports a failing procedure as a tool error result', async () => {
    const app = readApp();

    const response = await call(app, 'get_work_order', {
      params: { id: 'missing-order' },
    });

    const body = (await response.json()) as {
      result: { isError: boolean; structuredContent: { code: number } };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.code).toBe(404);
  });
});

describe('MCP transport errors', () => {
  it('answers invalid JSON with a parse error', async () => {
    const app = readApp();

    const response = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: '{not json',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: null,
      error: { code: -32700 },
    });
  });

  it('answers a message without method with an invalid request error', async () => {
    const app = readApp();

    const response = await rpc(app, { jsonrpc: '2.0', id: 7 });

    expect(await response.json()).toMatchObject({
      id: null,
      error: { code: -32600 },
    });
  });

  it('answers an unknown method with method not found', async () => {
    const app = readApp();

    const response = await rpc(app, {
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/list',
    });

    expect(await response.json()).toMatchObject({
      id: 3,
      error: { code: -32601 },
    });
  });

  it('rejects a request without bearer token as unauthorized', async () => {
    const app = readApp();

    const response = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: 401,
      type: 'unauthorized',
    });
  });

  it('rejects a request carrying a browser Origin header', async () => {
    const app = readApp();

    const response = await rpc(
      app,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { origin: 'https://evil.example' },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 403,
      type: 'forbidden',
    });
  });

  it('rejects a non JSON content type with bad request', async () => {
    const app = readApp();

    const response = await app.request('/api/v1/mcp', {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'text/plain' },
      body: '{}',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 400,
      type: 'bad-request',
    });
  });
});
