import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  createTestApp,
  deleteJson,
  getJson,
  postJson,
  type TestContext,
} from '../support/test-app';
import { SESSION_SECRET_PREFIX } from '../support/fakes';

const REPO = '/work/app';
const JOIN_SECRET = 'join-secret-cells-4d1e';

type CellDto = {
  slotId: string;
  name: string;
  runtimeStatus: string;
  desiredState: string;
  lastError: string | null;
};

const setup = async (): Promise<TestContext> => {
  const context = createTestApp();
  context.repoInspector.addRepo(REPO);
  await postJson(context.app, '/api/v1/factories', {
    name: 'local',
    url: 'http://127.0.0.1:7070',
    joinToken: JOIN_SECRET,
  });
  return context;
};

const createCells = (context: TestContext, body: Record<string, unknown>) =>
  postJson(context.app, '/api/v1/cells', { repoRoot: REPO, ...body });

const listedCells = async (context: TestContext): Promise<CellDto[]> => {
  const response = await getJson(context.app, '/api/v1/cells');
  return ((await response.json()) as { cells: CellDto[] }).cells;
};

const cellsOf = async (response: Response): Promise<CellDto[]> =>
  ((await response.json()) as { cells: CellDto[] }).cells;

const cellByName = async (context: TestContext, name: string) =>
  (await listedCells(context)).find((cell) => cell.name === name);

describe('cell slots API', () => {
  it('creates three unique cells that run without exposing a session secret', async () => {
    const context = await setup();

    const response = await createCells(context, { count: 3 });
    const body = await response.text();

    const host = hostname();
    expect(response.status).toBe(201);
    const cells = (JSON.parse(body) as { cells: CellDto[] }).cells;
    expect(cells.map((cell) => cell.name)).toEqual([
      host,
      `${host}-2`,
      `${host}-3`,
    ]);
    expect(cells.map((cell) => cell.runtimeStatus)).toEqual([
      'running',
      'running',
      'running',
    ]);
    expect(body).not.toContain(SESSION_SECRET_PREFIX);
    expect(body).not.toContain('sessionToken');
  });

  it('enrolls every new cell with the factory join token', async () => {
    const context = await setup();

    await createCells(context, { count: 2 });

    expect(context.factoryClient.enrolls).toHaveLength(2);
    expect(
      context.factoryClient.enrolls.every(
        (call) => call.joinToken === JOIN_SECRET,
      ),
    ).toBe(true);
  });

  it('keeps session secrets out of every listing', async () => {
    const context = await setup();
    await createCells(context, { count: 2 });

    const body = await (await getJson(context.app, '/api/v1/cells')).text();

    expect(body).not.toContain(SESSION_SECRET_PREFIX);
    expect(body).not.toContain(JOIN_SECRET);
  });

  it('stops every cell with stop-all and persists the stopped desire', async () => {
    const context = await setup();
    await createCells(context, { count: 3 });

    const response = await postJson(context.app, '/api/v1/cells/stop-all', {});

    expect(response.status).toBe(200);
    const cells = await cellsOf(response);
    expect(cells.map((cell) => cell.desiredState)).toEqual([
      'stopped',
      'stopped',
      'stopped',
    ]);
    expect(cells.map((cell) => cell.runtimeStatus)).toEqual([
      'stopped',
      'stopped',
      'stopped',
    ]);
    expect(context.supervisor.stops).toHaveLength(3);
  });

  it('stops one cell by name and leaves its siblings running', async () => {
    const context = await setup();
    await createCells(context, { count: 2 });
    const target = `${hostname()}-2`;

    const response = await postJson(
      context.app,
      `/api/v1/cells/${target}/stop`,
      {},
    );

    expect(response.status).toBe(200);
    expect(await cellByName(context, target)).toMatchObject({
      desiredState: 'stopped',
      runtimeStatus: 'stopped',
    });
    expect(await cellByName(context, hostname())).toMatchObject({
      runtimeStatus: 'running',
    });
  });

  it('refuses to remove a running cell and removes it once stopped', async () => {
    const context = await setup();
    await createCells(context, { count: 1 });
    const name = hostname();
    const slotId = (await cellByName(context, name))?.slotId ?? '';

    const refused = await deleteJson(context.app, `/api/v1/cells/${slotId}`);
    await postJson(context.app, `/api/v1/cells/${slotId}/stop`, {});
    const removed = await deleteJson(context.app, `/api/v1/cells/${slotId}`);

    expect(refused.status).toBe(409);
    expect(removed.status).toBe(200);
    expect(await listedCells(context)).toEqual([]);
  });

  it('starts a stopped cell again by its name', async () => {
    const context = await setup();
    await createCells(context, { count: 1 });
    const name = hostname();
    await postJson(context.app, `/api/v1/cells/${name}/stop`, {});

    const response = await postJson(
      context.app,
      `/api/v1/cells/${name}/start`,
      undefined,
    );

    expect(response.status).toBe(200);
    expect(await cellByName(context, name)).toMatchObject({
      desiredState: 'running',
      runtimeStatus: 'running',
    });
  });

  it('answers 409 when starting a cell that is already running', async () => {
    const context = await setup();
    await createCells(context, { count: 1 });

    const response = await postJson(
      context.app,
      `/api/v1/cells/${hostname()}/start`,
      undefined,
    );

    expect(response.status).toBe(409);
  });

  it('answers 404 when the cell reference is unknown', async () => {
    const context = await setup();

    const response = await postJson(
      context.app,
      '/api/v1/cells/missing/start',
      undefined,
    );

    expect(response.status).toBe(404);
  });

  it('answers 400 when count exceeds max_local_cells', async () => {
    const context = await setup();

    const response = await createCells(context, { count: 5 });

    expect(response.status).toBe(400);
    expect(await listedCells(context)).toEqual([]);
  });

  it('answers 400 when a name is given for more than one cell', async () => {
    const context = await setup();

    const response = await createCells(context, { count: 2, name: 'side' });

    expect(response.status).toBe(400);
  });

  it('answers 400 when the repo has no factory config', async () => {
    const context = await setup();

    const response = await postJson(context.app, '/api/v1/cells', {
      repoRoot: '/not/a/factory/repo',
    });

    expect(response.status).toBe(400);
  });

  it('keeps a cell with its error when its worker cannot start', async () => {
    const context = await setup();
    context.supervisor.failStarts = true;

    const response = await createCells(context, { count: 1 });

    const [cell] = await cellsOf(response);
    expect(cell).toMatchObject({
      runtimeStatus: 'failed',
      lastError: 'spawn failed',
    });
  });

  it('answers 502 and stores no cell when the factory refuses enrollment', async () => {
    const context = await setup();
    context.factoryClient.failEnroll = true;

    const response = await createCells(context, { count: 2 });

    expect(response.status).toBe(502);
    expect(await listedCells(context)).toEqual([]);
  });
});
