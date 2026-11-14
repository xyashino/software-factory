import { describe, expect, it } from 'vitest';
import type { CellId } from '@repo/factory-core/ids';
import { RuntimeError } from '../errors';
import { createOrder, helloCell, world } from './test-kit';

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

    expect(response.events.map((stored) => stored.orderId)).toEqual([orderId]);
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

describe('intake sync', () => {
  it('refuses with a precondition while intake is not wired, and changes nothing', async () => {
    const w = world();

    const refused = await w.runtime
      .call('intakeSync', { commandId: COMMAND })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(RuntimeError);
    expect((refused as RuntimeError).wire).toEqual({
      code: 'precondition',
      detail: 'intake is not built yet (v2-10): nothing was synced',
    });
    expect(await w.events.orders()).toEqual([]);
  });

  it('answers with the count of Work orders the wired intake opened', async () => {
    const w = world();
    w.ports.intake = { sync: async () => ({ created: 3 }) };

    expect(await w.runtime.call('intakeSync', { commandId: COMMAND })).toEqual({
      created: 3,
    });
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
