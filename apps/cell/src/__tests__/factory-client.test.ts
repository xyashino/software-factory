import { describe, expect, it, vi } from 'vitest';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { CellId, CommitSha, OrderId } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import {
  commandIdOf,
  factoryDataDirOf,
  socketFactoryClient,
  socketPathIn,
} from '../factory-client';

const CELL = '01J0000000000000000000000W' as CellId;
const ORDER = 'software-factory:feature-1' as OrderId;
const COMMIT = 'a'.repeat(40) as CommitSha;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Replies in order from a script; the last reply repeats. */
const scripted = (...replies: Response[]) => {
  let index = 0;
  return vi.fn(async (url: string, init: RequestInit) => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (!reply) throw new Error(`no scripted reply for ${url} ${init.method}`);
    return reply.clone();
  });
};

const noSleep = async (): Promise<void> => {};

const claimOptions = { cellId: CELL, waitMs: 0 };

describe('socket factory client', () => {
  it('answers a call with the validated response body', async () => {
    const fetchImpl = scripted(json(200, { job: null }));
    const client = socketFactoryClient({
      socketPath: '/tmp/unused.sock',
      fetchImpl,
      sleep: noSleep,
    });

    const answer = await client.call('claim', claimOptions);

    expect(answer).toEqual({ job: null });
  });

  it('sends the same body again on a 5xx answer, then succeeds', async () => {
    const fetchImpl = scripted(
      json(503, { code: 'unavailable' }),
      json(200, { job: null }),
    );
    const client = socketFactoryClient({
      socketPath: '/tmp/unused.sock',
      fetchImpl,
      sleep: noSleep,
    });

    await client.call('claim', claimOptions);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [first, second] = fetchImpl.mock.calls.map(([, init]) => init?.body);
    expect(second).toBe(first);
  });

  it('retries a network failure, then gives up with unavailable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket closed');
    });
    const client = socketFactoryClient({
      socketPath: '/tmp/unused.sock',
      attempts: 3,
      fetchImpl,
      sleep: noSleep,
    });

    const failure = await client.call('claim', claimOptions).catch((e) => e);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(failure).toBeInstanceOf(WireFailure);
    expect(failure.error).toEqual({ code: 'unavailable' });
    expect(failure.status).toBe(503);
  });

  it('pauses longer before each later try, up to the cap', async () => {
    const pauses: number[] = [];
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket closed');
    });
    const client = socketFactoryClient({
      socketPath: '/tmp/unused.sock',
      attempts: 4,
      baseDelayMs: 10,
      maxDelayMs: 25,
      fetchImpl,
      sleep: async (ms) => {
        pauses.push(ms);
      },
    });

    await client.call('claim', claimOptions).catch(() => undefined);

    expect(pauses).toEqual([10, 20, 25]);
  });

  it('stops retrying once the caller deadline is reached', async () => {
    let clock = 1_000;
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket closed');
    });
    const client = socketFactoryClient({
      socketPath: '/tmp/unused.sock',
      attempts: 10,
      baseDelayMs: 10,
      maxDelayMs: 10,
      retryUntil: 1_025,
      now: () => clock,
      fetchImpl,
      sleep: async (ms) => {
        clock += ms;
      },
    });

    const failure = await client.call('claim', claimOptions).catch((e) => e);

    // Tries at t=1000, 1010, 1020; the pause to 1030 would pass 1025, so it stops at 3 tries.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(clock).toBe(1_020);
    expect(failure).toBeInstanceOf(WireFailure);
    expect(failure.error).toEqual({ code: 'unavailable' });
    expect(failure.status).toBe(503);
  });

  it('does not retry a refusal and throws it with its wire code', async () => {
    const fetchImpl = scripted(
      json(409, { code: 'stale_epoch', current: 4 }),
      json(200, { job: null }),
    );
    const client = socketFactoryClient({
      socketPath: '/tmp/unused.sock',
      fetchImpl,
      sleep: noSleep,
    });

    const failure = await client
      .call('submitCommand', {
        cellId: CELL,
        orderId: ORDER,
        commandId: 'stale',
        epoch: 1,
        command: { type: 'StartCycle', baseCommit: COMMIT },
      })
      .catch((e) => e);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(failure).toBeInstanceOf(WireFailure);
    expect(failure.error).toEqual({ code: 'stale_epoch', current: 4 });
    expect(failure.status).toBe(409);
  });

  it('surfaces an unauthorized Cell distinctly from an outage', async () => {
    const client = socketFactoryClient({
      socketPath: '/tmp/unused.sock',
      fetchImpl: scripted(json(401, { code: 'unauthorized' })),
      sleep: noSleep,
    });

    const failure = await client
      .call('claim', claimOptions)
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(WireFailure);
    expect((failure as WireFailure).error).toEqual({ code: 'unauthorized' });
  });

  it('refuses an invalid request before it reaches the socket', async () => {
    const fetchImpl = scripted(json(200, { job: null }));
    const client = socketFactoryClient({
      socketPath: '/tmp/unused.sock',
      fetchImpl,
      sleep: noSleep,
    });

    await expect(
      client.call('claim', { cellId: 'not-a-ulid' as CellId, waitMs: 0 }),
    ).rejects.toThrow();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads the socket path from the data directory', () => {
    expect(socketPathIn('/var/factory')).toBe('/var/factory/factory.sock');
  });

  it('takes the data directory from the environment, else the default', () => {
    expect(factoryDataDirOf({ FACTORY_DATA_DIR: '/var/factory' })).toBe(
      '/var/factory',
    );
    expect(factoryDataDirOf({})).toMatch(/\.local\/share\/factory$/);
  });
});

describe('content-derived command ids', () => {
  const start: OrderCommand = { type: 'StartCycle', baseCommit: COMMIT };

  it('gives the same id to the same content', () => {
    const first = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 1,
      command: start,
    });
    const again = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 1,
      command: { ...start },
    });

    expect(again).toBe(first);
  });

  it('gives another id to another command, epoch or Cell', () => {
    const base = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 1,
      command: start,
    });
    const otherEpoch = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 2,
      command: start,
    });
    const report = commandIdOf({
      cellId: CELL,
      orderId: ORDER,
      epoch: 1,
      command: { type: 'Nudge', text: 'x' },
    });

    expect(otherEpoch).not.toBe(base);
    expect(report).not.toBe(base);
  });

  it('ignores the order of keys in the command', () => {
    const reordered = {
      baseCommit: COMMIT,
      type: 'StartCycle',
    } as OrderCommand;

    expect(
      commandIdOf({
        cellId: CELL,
        orderId: ORDER,
        epoch: 1,
        command: reordered,
      }),
    ).toBe(
      commandIdOf({ cellId: CELL, orderId: ORDER, epoch: 1, command: start }),
    );
  });

  it('stays within the 128 characters the wire allows', () => {
    expect(
      commandIdOf({ cellId: CELL, orderId: ORDER, epoch: 1, command: start })
        .length,
    ).toBeLessThanOrEqual(128);
  });
});
