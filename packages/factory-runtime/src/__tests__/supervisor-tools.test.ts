import { describe, expect, it } from 'vitest';
import type { CellId, ProjectId } from '@repo/factory-core/ids';
import { RuntimeError } from '../errors';
import { createOrder, helloCell, PROJECT, REPO, world } from './test-kit';

const CELL = '01J0000000000000000000000W' as CellId;
const COMMAND = '01J00000000000000000000001';
const OTHER_COMMAND = '01J00000000000000000000002';

describe('supervisor event feed', () => {
  it('returns the events after a position, oldest first, and says where the feed ends', async () => {
    const w = world();
    const orderId = await createOrder(w, { todoId: 'todo-a' });

    const response = await w.runtime.call('supervisorEvents', {
      afterGlobalSeq: 0,
    });

    expect(response.events).toMatchObject([{ orderId }]);
    expect(response.nextSeq).toBe(response.events[0]?.globalSeq);
  });

  it('answers at once with nothing when no event is newer and the wait is zero', async () => {
    const w = world();
    await createOrder(w, { todoId: 'todo-a' });

    const response = await w.runtime.call('supervisorEvents', {
      afterGlobalSeq: 1_000,
      waitMs: 0,
    });

    expect(response).toEqual({ events: [], nextSeq: 1_000 });
  });

  it('holds the request until a commit wakes it, then answers with the new events', async () => {
    const w = world();
    const waiting = w.runtime.call('supervisorEvents', {
      afterGlobalSeq: 0,
      waitMs: 25_000,
    });
    await createOrder(w, { todoId: 'todo-b' });

    const response = await waiting;

    expect(response.events.length).toBeGreaterThan(0);
  });

  it('ends an empty wait when the wait runs out', async () => {
    const w = world();
    const waiting = w.runtime.call('supervisorEvents', {
      afterGlobalSeq: 0,
      waitMs: 500,
    });
    w.timers.advance(500);

    expect(await waiting).toEqual({ events: [], nextSeq: 0 });
  });
});

describe('join tokens', () => {
  it('creates a token that is returned once, then lists it without the token', async () => {
    const w = world();

    const created = await w.runtime.call('joinTokenCreate', {
      commandId: COMMAND,
      name: 'pool',
      ttlSeconds: 3600,
    });
    const listed = await w.runtime.call('joinTokenList', {});

    expect(created.token.length).toBeGreaterThan(20);
    expect(created.expiresAt).toBe(w.clock.now() + 3_600_000);
    expect(listed.tokens).toEqual([
      {
        joinTokenId: created.joinTokenId,
        name: 'pool',
        createdAt: w.clock.now(),
        expiresAt: created.expiresAt,
        revokedAt: null,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain(created.token);
    expect(w.joinTokens.hashes()).not.toContain(created.token);
  });

  it('revokes a token once and refuses an unknown id as not found', async () => {
    const w = world();
    const created = await w.runtime.call('joinTokenCreate', {
      commandId: COMMAND,
      name: 'pool',
    });

    const revoked = await w.runtime.call('joinTokenRevoke', {
      joinTokenId: created.joinTokenId,
    });
    const refused = await w.runtime
      .call('joinTokenRevoke', { joinTokenId: 'nope' })
      .catch((error: unknown) => error);

    expect(revoked).toEqual({
      joinTokenId: created.joinTokenId,
      revoked: true,
    });
    expect(refused).toBeInstanceOf(RuntimeError);
    expect((refused as RuntimeError).wire).toEqual({ code: 'not_found' });
  });

  it('refuses a replayed create for the same command, so a retry makes no second token', async () => {
    const w = world();
    await w.runtime.call('joinTokenCreate', {
      commandId: COMMAND,
      name: 'pool',
    });

    const replayed = await w.runtime
      .call('joinTokenCreate', { commandId: COMMAND, name: 'pool' })
      .catch((error: unknown) => error);
    const listed = await w.runtime.call('joinTokenList', {});

    expect(replayed).toBeInstanceOf(RuntimeError);
    expect((replayed as RuntimeError).wire.code).toBe('precondition');
    expect(listed.tokens).toHaveLength(1);
  });

  it('creates a second token for a new command id', async () => {
    const w = world();
    await w.runtime.call('joinTokenCreate', {
      commandId: COMMAND,
      name: 'pool',
    });

    await w.runtime.call('joinTokenCreate', {
      commandId: OTHER_COMMAND,
      name: 'pool',
    });

    expect((await w.runtime.call('joinTokenList', {})).tokens).toHaveLength(2);
  });

  it('refuses a token create while the writer lock is not held', async () => {
    const w = world();
    w.writer.held = false;

    await expect(
      w.runtime.call('joinTokenCreate', { commandId: COMMAND, name: 'pool' }),
    ).rejects.toThrow();
  });
});

describe('project registry', () => {
  const DEMO = 'demo' as ProjectId;
  const DEMO_REPO = 'https://example.test/demo.git';

  const refusalOf = (error: unknown): RuntimeError => {
    expect(error).toBeInstanceOf(RuntimeError);
    return error as RuntimeError;
  };

  it('lists the registered projects with their settings', async () => {
    const w = world();

    expect(await w.runtime.call('projectList', {})).toEqual({
      projects: [
        {
          projectId: PROJECT,
          repoUrl: REPO,
          baseBranch: 'main',
          maxRunning: 2,
          depPolicy: 'delivered',
        },
      ],
    });
  });

  it('registers a project and answers with the record as stored', async () => {
    const w = world();

    const added = await w.runtime.call('projectAdd', {
      projectId: DEMO,
      repoUrl: DEMO_REPO,
      baseBranch: 'main',
      maxRunning: 3,
      depPolicy: 'merged',
    });

    expect(added).toEqual({
      project: {
        projectId: DEMO,
        repoUrl: DEMO_REPO,
        baseBranch: 'main',
        maxRunning: 3,
        depPolicy: 'merged',
      },
    });
    expect((await w.runtime.call('projectList', {})).projects).toHaveLength(2);
  });

  it('refuses to register a project whose id exists as precondition', async () => {
    const w = world();

    const refused = await w.runtime
      .call('projectAdd', {
        projectId: PROJECT,
        repoUrl: REPO,
        baseBranch: 'main',
        maxRunning: 2,
        depPolicy: 'delivered',
      })
      .catch((error: unknown) => error);

    expect(refusalOf(refused).wire.code).toBe('precondition');
  });

  it('changes max running and reads the change back', async () => {
    const w = world();

    const changed = await w.runtime.call('projectSet', {
      projectId: PROJECT,
      maxRunning: 5,
    });

    expect(changed.project.maxRunning).toBe(5);
    expect(changed.project.repoUrl).toBe(REPO);
  });

  it('refuses a base branch change while a Work order is open', async () => {
    const w = world();
    await createOrder(w, { todoId: 'todo-open' });

    const refused = await w.runtime
      .call('projectSet', { projectId: PROJECT, baseBranch: 'develop' })
      .catch((error: unknown) => error);

    expect(refusalOf(refused).wire.code).toBe('precondition');
    expect((refusalOf(refused).wire as { detail: string }).detail).toMatch(
      /base branch/,
    );
  });

  it('refuses to remove a project that has a Work order', async () => {
    const w = world();
    await createOrder(w, { todoId: 'todo-kept' });

    const refused = await w.runtime
      .call('projectRemove', { projectId: PROJECT })
      .catch((error: unknown) => error);

    expect(refusalOf(refused).wire.code).toBe('precondition');
  });

  it('removes a project with no history', async () => {
    const w = world();
    await w.runtime.call('projectAdd', {
      projectId: DEMO,
      repoUrl: DEMO_REPO,
      baseBranch: 'main',
      maxRunning: 2,
      depPolicy: 'delivered',
    });

    expect(await w.runtime.call('projectRemove', { projectId: DEMO })).toEqual({
      projectId: DEMO,
      removed: true,
    });
    expect((await w.runtime.call('projectList', {})).projects).toHaveLength(1);
  });

  it('refuses set and remove of an unknown project as not found', async () => {
    const w = world();

    const setRefused = await w.runtime
      .call('projectSet', { projectId: DEMO, maxRunning: 2 })
      .catch((error: unknown) => error);
    const removeRefused = await w.runtime
      .call('projectRemove', { projectId: DEMO })
      .catch((error: unknown) => error);

    expect(refusalOf(setRefused).wire).toEqual({ code: 'not_found' });
    expect(refusalOf(removeRefused).wire).toEqual({ code: 'not_found' });
  });

  it('refuses every project write while the writer lock is not held', async () => {
    const w = world();
    w.writer.held = false;

    await expect(
      w.runtime.call('projectAdd', {
        projectId: DEMO,
        repoUrl: DEMO_REPO,
        baseBranch: 'main',
        maxRunning: 2,
        depPolicy: 'delivered',
      }),
    ).rejects.toThrow();
    await expect(
      w.runtime.call('projectSet', { projectId: PROJECT, maxRunning: 3 }),
    ).rejects.toThrow();
    await expect(
      w.runtime.call('projectRemove', { projectId: PROJECT }),
    ).rejects.toThrow();
  });
});

describe('admin export', () => {
  it('returns the export archive as base64 with its size', async () => {
    const w = world();

    const response = await w.runtime.call('adminExport', {});

    expect(Buffer.from(response.base64, 'base64').toString()).toBe(
      'export-bytes',
    );
    expect(response.bytes).toBe('export-bytes'.length);
  });
});

describe('a cell is still needed for supervisor routes', () => {
  it('keeps the cell route table unchanged by the supervisor additions', async () => {
    const w = world();
    await helloCell(w, CELL);
    const cells = await w.runtime.call('cellsList', {});

    expect(cells.cells.map((cell) => cell.cellId)).toEqual([CELL]);
  });
});
