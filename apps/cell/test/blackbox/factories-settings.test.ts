import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client';
import { cells } from '../../src/db/schema/cells';
import { asFactoryId, asSlotId } from '../../src/domain/common/brand';
import {
  createTestApp,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  type TestApp,
} from '../support/test-app';

const SEED_AT = 1_700_000_000_000;
const JOIN_SECRET = 'join-secret-7f3a';
const SUPERVISOR_SECRET = 'supervisor-secret-9c2b';

type FactoryDto = {
  factoryId: string;
  name: string;
  url: string;
  isDefault: boolean;
  hasJoinToken: boolean;
  hasSupervisorToken: boolean;
};

type FactoryReply = { factory: FactoryDto };

type SettingsDto = {
  herdr_enabled: boolean;
  default_runner: string;
  restart_backoff_ms: number;
  max_local_cells: number;
  git_fetch_on_worktree: boolean;
};

type SettingsReply = { settings: SettingsDto };

const jsonOf = async <T>(response: Response): Promise<T> =>
  (await response.json()) as T;

const addFactory = (app: TestApp, body: Record<string, unknown>) =>
  postJson(app, '/api/v1/factories', body);

const addedFactoryOf = async (app: TestApp, body: Record<string, unknown>) =>
  (await jsonOf<FactoryReply>(await addFactory(app, body))).factory;

const setDefault = (app: TestApp, factoryId: string) =>
  postJson(app, `/api/v1/factories/${factoryId}/default`, undefined);

const listedFactories = async (app: TestApp) => {
  const response = await getJson(app, '/api/v1/factories');
  return (await jsonOf<{ factories: FactoryDto[] }>(response)).factories;
};

const firstFactoryIdOf = async (app: TestApp) =>
  (await listedFactories(app))[0]?.factoryId ?? '';

const defaultFactoryIdOf = async (app: TestApp) => {
  const health = await jsonOf<{
    defaultFactory: { factoryId: string } | null;
  }>(await getJson(app, '/api/v1/health'));
  return health.defaultFactory?.factoryId ?? null;
};

const seedCellReferencing = (db: Db, factoryId: string) =>
  db
    .insert(cells)
    .values({
      slotId: asSlotId('slot-1'),
      cellId: null,
      factoryId: asFactoryId(factoryId),
      repoRoot: '/repo',
      name: 'main',
      desiredState: 'stopped',
      runtimeStatus: 'stopped',
      pid: null,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .run();

describe('factories API', () => {
  it('lists an added factory and never returns its join token', async () => {
    const { app } = createTestApp();

    const response = await addFactory(app, {
      name: 'vps',
      url: 'https://factory.example.com',
      joinToken: JOIN_SECRET,
    });

    expect(response.status).toBe(200);
    const listed = await listedFactories(app);
    expect(listed).toEqual([
      expect.objectContaining({
        name: 'vps',
        url: 'https://factory.example.com',
        hasJoinToken: true,
        hasSupervisorToken: false,
      }),
    ]);
    expect(listed[0]).not.toHaveProperty('joinToken');
  });

  it('makes the first added factory the default', async () => {
    const { app } = createTestApp();

    const added = await addedFactoryOf(app, {
      name: 'local',
      url: 'http://127.0.0.1:7070',
    });

    expect(await defaultFactoryIdOf(app)).toBe(added.factoryId);
  });

  it('keeps exactly one default when a second factory is added as default', async () => {
    const { app } = createTestApp();
    await addFactory(app, { name: 'local', url: 'http://127.0.0.1:7070' });

    const vps = await addedFactoryOf(app, {
      name: 'vps',
      url: 'https://factory.example.com',
      isDefault: true,
    });

    const defaults = (await listedFactories(app)).filter((f) => f.isDefault);
    expect(defaults.map((f) => f.name)).toEqual(['vps']);
    expect(await defaultFactoryIdOf(app)).toBe(vps.factoryId);
  });

  it('switches the default factory when set-default is called', async () => {
    const { app } = createTestApp();
    await addFactory(app, { name: 'local', url: 'http://127.0.0.1:7070' });
    const vps = await addedFactoryOf(app, {
      name: 'vps',
      url: 'https://factory.example.com',
    });

    const response = await setDefault(app, vps.factoryId);

    expect(response.status).toBe(200);
    expect(await defaultFactoryIdOf(app)).toBe(vps.factoryId);
    const defaults = (await listedFactories(app)).filter((f) => f.isDefault);
    expect(defaults.map((f) => f.name)).toEqual(['vps']);
  });

  it('answers 404 when set-default names an unknown factory', async () => {
    const { app } = createTestApp();

    const response = await setDefault(app, 'missing-id');

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 404,
      type: 'not-found',
    });
  });

  it('lists the default factory first and the rest by name', async () => {
    const { app } = createTestApp();
    await addFactory(app, { name: 'zeta', url: 'http://zeta.local' });
    await addFactory(app, { name: 'alpha', url: 'http://alpha.local' });
    await addFactory(app, { name: 'mid', url: 'http://mid.local' });
    const zeta = (await listedFactories(app)).find((f) => f.name === 'zeta');
    await setDefault(app, zeta?.factoryId ?? '');

    const names = (await listedFactories(app)).map((f) => f.name);

    expect(names).toEqual(['zeta', 'alpha', 'mid']);
  });

  it('updates the url of a factory with the same name and keeps its id', async () => {
    const { app } = createTestApp();
    const first = await addedFactoryOf(app, {
      name: 'vps',
      url: 'https://old.example.com',
    });

    await addFactory(app, { name: 'vps', url: 'https://new.example.com' });

    const listed = await listedFactories(app);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      factoryId: first.factoryId,
      url: 'https://new.example.com',
    });
  });

  it('keeps a stored join token when an update omits it and clears it on null', async () => {
    const { app } = createTestApp();
    await addFactory(app, {
      name: 'vps',
      url: 'https://factory.example.com',
      joinToken: JOIN_SECRET,
    });

    await addFactory(app, { name: 'vps', url: 'https://factory.example.com' });
    const kept = await listedFactories(app);
    await addFactory(app, {
      name: 'vps',
      url: 'https://factory.example.com',
      joinToken: null,
    });
    const cleared = await listedFactories(app);

    expect(kept[0]?.hasJoinToken).toBe(true);
    expect(cleared[0]?.hasJoinToken).toBe(false);
  });

  it('answers 400 when the url is not http or https', async () => {
    const { app } = createTestApp();

    const response = await addFactory(app, {
      name: 'vps',
      url: 'ftp://factory.example.com',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 400,
      type: 'bad-request',
    });
    expect(await listedFactories(app)).toEqual([]);
  });

  it('answers 400 when the name is blank', async () => {
    const { app } = createTestApp();

    const response = await addFactory(app, {
      name: '   ',
      url: 'http://127.0.0.1:7070',
    });

    expect(response.status).toBe(400);
  });

  it('answers 409 when a cell slot still references the factory', async () => {
    const { app, db } = createTestApp();
    const added = await addedFactoryOf(app, {
      name: 'local',
      url: 'http://127.0.0.1:7070',
    });
    seedCellReferencing(db, added.factoryId);

    const response = await deleteJson(
      app,
      `/api/v1/factories/${added.factoryId}`,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 409,
      type: 'conflict',
    });
    expect(await listedFactories(app)).toHaveLength(1);
  });

  it('deletes a factory that no cell slot references', async () => {
    const { app } = createTestApp();
    const added = await addedFactoryOf(app, {
      name: 'local',
      url: 'http://127.0.0.1:7070',
    });

    const response = await deleteJson(
      app,
      `/api/v1/factories/${added.factoryId}`,
    );

    expect(response.status).toBe(200);
    expect(await listedFactories(app)).toEqual([]);
  });

  it('never includes raw token text in any factory response', async () => {
    const { app } = createTestApp();
    const added = await addFactory(app, {
      name: 'vps',
      url: 'https://factory.example.com',
      joinToken: JOIN_SECRET,
      supervisorToken: SUPERVISOR_SECRET,
    });
    const bodies = [
      await added.text(),
      await (await getJson(app, '/api/v1/factories')).text(),
      await (await getJson(app, '/api/v1/health')).text(),
      await (await setDefault(app, await firstFactoryIdOf(app))).text(),
    ];

    for (const body of bodies) {
      expect(body).not.toContain(JOIN_SECRET);
      expect(body).not.toContain(SUPERVISOR_SECRET);
    }
  });
});

describe('settings API', () => {
  it('returns the default settings on a fresh database', async () => {
    const { app } = createTestApp();

    const response = await getJson(app, '/api/v1/settings');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      settings: {
        herdr_enabled: false,
        default_runner: 'claude',
        restart_backoff_ms: 1000,
        max_local_cells: 4,
        git_fetch_on_worktree: true,
      },
    });
  });

  it('merges a partial patch over the defaults and keeps it on the next read', async () => {
    const { app } = createTestApp();

    const patched = await patchJson(app, '/api/v1/settings', {
      default_runner: 'codex',
      max_local_cells: 8,
    });
    const next = await getJson(app, '/api/v1/settings');

    expect(patched.status).toBe(200);
    const expected = {
      herdr_enabled: false,
      default_runner: 'codex',
      restart_backoff_ms: 1000,
      max_local_cells: 8,
      git_fetch_on_worktree: true,
    };
    expect((await jsonOf<SettingsReply>(patched)).settings).toEqual(expected);
    expect((await jsonOf<SettingsReply>(next)).settings).toEqual(expected);
  });

  it('rejects an invalid value and persists none of the patch', async () => {
    const { app } = createTestApp();

    const response = await patchJson(app, '/api/v1/settings', {
      herdr_enabled: true,
      max_local_cells: 65,
    });
    const next = await jsonOf<SettingsReply>(
      await getJson(app, '/api/v1/settings'),
    );

    expect(response.status).toBe(400);
    expect(next.settings.herdr_enabled).toBe(false);
  });

  it('rejects an unknown setting key', async () => {
    const { app } = createTestApp();

    const response = await patchJson(app, '/api/v1/settings', {
      host: '0.0.0.0',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: 400,
      type: 'bad-request',
    });
  });
});
