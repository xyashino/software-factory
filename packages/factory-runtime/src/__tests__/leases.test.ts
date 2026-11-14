import { afterEach, describe, expect, it } from 'vitest';
import type {
  CommitSha,
  CycleId,
  JobId,
  WorkerId,
} from '@repo/factory-core/ids';
import { RuntimeError } from '../errors';
import { createOrder, flush, helloWorker, world, type World } from './test-kit';

const WORKER = '01J0000000000000000000000W' as WorkerId;
const OTHER_WORKER = '01J0000000000000000000000X' as WorkerId;
const UNKNOWN_JOB = '01J0000000000000000000000Z' as JobId;
const COMMIT = 'b'.repeat(40) as CommitSha;

let running: World | undefined;

afterEach(() => {
  running?.runtime.stop();
  running = undefined;
});

/** A Worker holding one plan job, with its Cycle started. */
const startedJob = async (w: World) => {
  await helloWorker(w, WORKER, 1, ['claude']);
  const orderId = await createOrder(w, { todoId: 'todo-a' });
  const claimed = await w.runtime.call('claim', {
    workerId: WORKER,
    waitMs: 0,
  });
  const job = claimed.job;
  if (!job) throw new Error('expected a job');
  await w.runtime.call('submitCommand', {
    workerId: WORKER,
    orderId,
    commandId: 'start-a',
    epoch: job.epoch,
    command: { type: 'StartCycle', baseCommit: COMMIT },
  });
  return { orderId, job };
};

describe('heartbeat', () => {
  it('keeps the job it holds ok and reports a job it does not hold as stale', async () => {
    const w = world();
    const { job } = await startedJob(w);

    const beat = await w.runtime.call('heartbeat', {
      workerId: WORKER,
      jobs: [job.jobId, UNKNOWN_JOB],
      acked: [],
    });

    expect(beat.jobs).toEqual([
      { jobId: job.jobId, status: 'ok' },
      { jobId: UNKNOWN_JOB, status: 'stale' },
    ]);
  });

  it('delivers a nudge to the live job until the Worker acknowledges it', async () => {
    const w = world();
    const { orderId, job } = await startedJob(w);
    await w.runtime.call('nudge', {
      orderId,
      commandId: 'nudge-1',
      text: 'keep going',
    });

    const first = await w.runtime.call('heartbeat', {
      workerId: WORKER,
      jobs: [job.jobId],
      acked: [],
    });
    expect(first.signals.map((signal) => [signal.kind, signal.jobId])).toEqual([
      ['nudge', job.jobId],
    ]);
    const signalId = first.signals[0]?.signalId ?? '';

    const second = await w.runtime.call('heartbeat', {
      workerId: WORKER,
      jobs: [job.jobId],
      acked: [signalId],
    });
    expect(second.signals).toEqual([]);
  });

  it('is refused for a Worker that was never registered', async () => {
    const w = world();

    const error = await w.runtime
      .call('heartbeat', { workerId: OTHER_WORKER, jobs: [], acked: [] })
      .catch((caught: unknown) => caught);

    expect((error as RuntimeError).wire).toEqual({ code: 'unauthorized' });
  });
});

describe('reaper', () => {
  it('expires a lost lease into cycle_failed{lost} and job_lost, then removes the lease', async () => {
    const w = world();
    running = w;
    const { orderId } = await startedJob(w);

    w.clock.advance(61_000);
    const reaped = await w.runtime.reapOnce();

    expect(reaped).toBe(1);
    expect(await w.leases.forWorker(WORKER)).toEqual([]);
    const types = (await w.events.load(orderId)).map(
      (stored) => stored.event.type,
    );
    expect(types).toEqual(expect.arrayContaining(['cycle_failed', 'job_lost']));
    const lost = (await w.events.load(orderId)).find(
      (stored) => stored.event.type === 'job_lost',
    );
    expect(lost?.event).toMatchObject({ reason: 'lease_expired' });
  });

  it('gives every lease a full TTL on boot', async () => {
    const w = world();
    running = w;
    await startedJob(w);
    w.clock.advance(120_000);

    await w.runtime.start();

    expect((await w.leases.forWorker(WORKER))[0]?.expiresAt).toBe(
      w.clock.now() + 60_000,
    );
    expect(await w.runtime.reapOnce()).toBe(0);
  });

  it('runs on its timer every reaperMs while started', async () => {
    const w = world();
    running = w;
    await startedJob(w);
    await w.runtime.start();
    w.clock.advance(60_000 + 1);
    await w.runtime.start();
    expect(w.timers.pending()).toBeGreaterThan(0);

    w.timers.advance(5_000);
    await flush();

    expect(await w.leases.forWorker(WORKER)).toEqual([]);
  });
});

describe('revocation', () => {
  it('expires the leases of a revoked Worker and refuses it afterwards', async () => {
    const w = world();
    running = w;
    await startedJob(w);

    await w.runtime.call('workerRevoke', { workerId: WORKER });
    expect(await w.runtime.reapOnce()).toBe(1);

    expect(await w.leases.forWorker(WORKER)).toEqual([]);
    const error = await w.runtime
      .call('heartbeat', { workerId: WORKER, jobs: [], acked: [] })
      .catch((caught: unknown) => caught);
    expect((error as RuntimeError).wire).toEqual({ code: 'unauthorized' });
  });

  it('refuses a claim by a revoked Worker', async () => {
    const w = world();
    running = w;
    await helloWorker(w, WORKER);
    await w.runtime.call('workerRevoke', { workerId: WORKER });

    const error = await w.runtime
      .call('claim', { workerId: WORKER, waitMs: 0 })
      .catch((caught: unknown) => caught);

    expect((error as RuntimeError).wire).toEqual({ code: 'unauthorized' });
  });
});

describe('completing a job', () => {
  it('releases the lease when the Cycle ends the job', async () => {
    const w = world();
    running = w;
    await helloWorker(w, WORKER, 1, ['claude']);
    const orderId = await createOrder(w, { todoId: 'todo-a' });
    const { job } = await w.runtime
      .call('claim', { workerId: WORKER, waitMs: 0 })
      .then((response) => ({ job: response.job! }));
    await w.runtime.call('submitCommand', {
      workerId: WORKER,
      orderId,
      commandId: 'start-b',
      epoch: job.epoch,
      command: { type: 'StartCycle', baseCommit: COMMIT },
    });
    const text = '# Plan\n';
    const plan = (await import('./test-kit')).sha256Ref(text);
    await w.blobs.put(plan, new TextEncoder().encode(text), 'text/markdown');

    await w.runtime.call('submitCommand', {
      workerId: WORKER,
      orderId,
      commandId: 'complete-b',
      epoch: job.epoch,
      command: {
        type: 'CompleteCycle',
        cycleId: job.station?.cycleId as CycleId,
        artifacts: { plan },
        commit: COMMIT,
      },
    });

    expect(
      (await w.leases.forWorker(WORKER)).map((lease) => lease.orderId),
    ).toEqual([]);
  });
});
