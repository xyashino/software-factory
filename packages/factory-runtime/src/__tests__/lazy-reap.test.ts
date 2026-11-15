import { afterEach, describe, expect, it } from 'vitest';
import type { CellId, CommitSha, JobId } from '@repo/factory-core/ids';
import { createOrder, helloCell, world, type World } from './test-kit';

const CELL = '01J0000000000000000000000W' as CellId;
const OTHER_CELL = '01J0000000000000000000000X' as CellId;
const COMMIT = 'b'.repeat(40) as CommitSha;
const TTL = 60_000;

let running: World | undefined;

afterEach(() => {
  running?.runtime.stop();
  running = undefined;
});

/** A Cell holding one job with its Cycle started, on a runtime that has passed boot grace. */
const startedJob = async (w: World) => {
  await helloCell(w, CELL, ['claude']);
  const orderId = await createOrder(w, { todoId: 'todo-a' });
  const claimed = await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
  const job = claimed.job;
  if (!job) throw new Error('expected a job');
  await w.runtime.call('submitCommand', {
    cellId: CELL,
    orderId,
    commandId: 'start-a',
    epoch: job.epoch,
    command: { type: 'StartCycle', baseCommit: COMMIT },
  });
  await w.runtime.start();
  return { orderId, job };
};

/** Lets the lease expire and the boot grace pass: the Cell has gone silent. */
const silentPastExpiry = (w: World): void => {
  w.clock.advance(TTL + 1);
};

describe('lazy reaping (PROTOCOL §5.4)', () => {
  it('returns a dead Cell lease to the queue on the next claim, before it offers a job', async () => {
    const w = world();
    running = w;
    const { orderId } = await startedJob(w);
    await helloCell(w, OTHER_CELL, ['claude']);
    silentPastExpiry(w);

    const claimed = await w.runtime.call('claim', {
      cellId: OTHER_CELL,
      waitMs: 0,
    });

    expect(await w.leases.forCell(CELL)).toEqual([]);
    const types = (await w.events.load(orderId)).map(
      (stored) => stored.event.type,
    );
    expect(types).toEqual(expect.arrayContaining(['cycle_failed', 'job_lost']));
    expect(claimed.job?.orderId).toBe(orderId);
  });

  it('reaps the lease on a heartbeat from the Cell that lost it, which answers stale', async () => {
    const w = world();
    running = w;
    const { job } = await startedJob(w);
    silentPastExpiry(w);

    const beat = await w.runtime.call('heartbeat', {
      cellId: CELL,
      jobs: [job.jobId as JobId],
      acked: [],
    });

    expect(beat.jobs).toEqual([{ jobId: job.jobId, status: 'stale' }]);
    expect(await w.leases.forCell(CELL)).toEqual([]);
  });

  it('reaps the lease on a board read, so the order is no longer held by a Cell', async () => {
    const w = world();
    running = w;
    const { orderId } = await startedJob(w);
    silentPastExpiry(w);

    const board = await w.runtime.call('board', {});

    expect(await w.leases.forCell(CELL)).toEqual([]);
    expect(
      board.orders.find((row) => row.orderId === orderId)?.holder,
    ).not.toBe('cell');
  });

  it('holds reaping through boot grace: a lease that lapsed before start is given a full TTL', async () => {
    const w = world();
    running = w;
    await helloCell(w, CELL, ['claude']);
    await createOrder(w, { todoId: 'todo-a' });
    await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
    w.clock.advance(TTL + 1);

    await w.runtime.start();
    const board = await w.runtime.call('board', {});

    expect((await w.leases.forCell(CELL))[0]?.expiresAt).toBe(
      w.clock.now() + TTL,
    );
    expect(board.orders[0]?.holder).toBe('cell');
  });

  it('registers no timer when started: nothing reaps unless a read or a claim asks', async () => {
    const w = world();
    running = w;
    await startedJob(w);
    silentPastExpiry(w);

    w.timers.advance(10 * TTL);
    await Promise.resolve();

    expect(w.timers.pending()).toBe(0);
    expect(await w.leases.forCell(CELL)).toHaveLength(1);
  });
});
