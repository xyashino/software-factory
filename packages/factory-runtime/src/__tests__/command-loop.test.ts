import { describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import type {
  BlobRef,
  CommitSha,
  CycleId,
  WorkerId,
} from '@repo/factory-core/ids';
import type { StoreTx } from '@repo/factory-core/ports/event-store';
import { createCommandHandler } from '../command-handler';
import { RuntimeError } from '../errors';
import type { RuntimePorts } from '../ports';
import {
  createOrder,
  flush,
  helloWorker,
  sha256Ref,
  world,
  type World,
} from './test-kit';

/** The store transaction the conflict wrappers replace. */
type StoreTxLike = StoreTx;

const WORKER = '01J0000000000000000000000W' as WorkerId;
const COMMIT = 'a'.repeat(40) as CommitSha;

/** Claims the next job for a Worker; the Worker must be registered and have a free slot. */
const claim = async (w: World, workerId: WorkerId = WORKER): Promise<Job> => {
  const response = await w.runtime.call('claim', { workerId, waitMs: 0 });
  if (!response.job) throw new Error('expected a job to be on offer');
  return response.job;
};

/** A stored artifact of the Operator, so CompleteCycle can name it. */
const artifactOf = async (w: World, text: string): Promise<BlobRef> => {
  const bytes = new TextEncoder().encode(text);
  const ref = sha256Ref(text);
  await w.blobs.put(ref, bytes, 'text/markdown');
  return ref;
};

/** Starts the job's Cycle and completes it with its plan artifact; the Worker's command ends the job. */
const runPlanStation = async (
  w: World,
  job: Job,
  ids: { start: string; complete: string },
  options: { dryRun?: boolean } = {},
) => {
  const station = job.station;
  if (!station?.cycleId) throw new Error('job has no Cycle');
  await w.runtime.call('submitCommand', {
    workerId: WORKER,
    orderId: job.orderId,
    commandId: ids.start,
    epoch: job.epoch,
    command: { type: 'StartCycle', baseCommit: COMMIT },
  });
  const plan = await artifactOf(w, '# Plan\n');
  return w.runtime.call('submitCommand', {
    workerId: WORKER,
    orderId: job.orderId,
    commandId: ids.complete,
    epoch: job.epoch,
    command: {
      type: 'CompleteCycle',
      cycleId: station.cycleId as CycleId,
      artifacts: { plan },
      commit: COMMIT,
    },
    ...(options.dryRun ? { dryRun: true } : {}),
  });
};

describe('command loop', () => {
  it('a duplicate commandId returns the stored response, including the next job', async () => {
    const w = world();
    await helloWorker(w, WORKER);
    const orderId = await createOrder(w, { todoId: 'todo-a' });
    const job = await claim(w);

    const first = await runPlanStation(w, job, {
      start: 's-1',
      complete: 'c-1',
    });
    const again = await w.runtime.call('submitCommand', {
      workerId: WORKER,
      orderId,
      commandId: 'c-1',
      epoch: job.epoch,
      command: {
        type: 'CompleteCycle',
        cycleId: job.station?.cycleId as CycleId,
        artifacts: { plan: await artifactOf(w, '# Plan\n') },
        commit: COMMIT,
      },
    });

    expect(first.next?.kind).toBe('run_operator_station');
    expect(first.next?.station?.stationId).toBe('plan-review');
    expect(again).toEqual(first);
  });

  it('a stale epoch is refused and nothing is appended', async () => {
    const w = world();
    await helloWorker(w, WORKER);
    const orderId = await createOrder(w, { todoId: 'todo-a' });
    const job = await claim(w);
    const before = (await w.events.load(orderId)).length;

    const refused = await w.runtime
      .call('submitCommand', {
        workerId: WORKER,
        orderId,
        commandId: 's-stale',
        epoch: job.epoch + 1,
        command: { type: 'StartCycle', baseCommit: COMMIT },
      })
      .catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(RuntimeError);
    expect((refused as RuntimeError).wire).toEqual({
      code: 'stale_epoch',
      current: job.epoch,
    });
    expect((await w.events.load(orderId)).length).toBe(before);
  });

  it('a dry run returns the events it would produce and appends nothing', async () => {
    const w = world();
    await helloWorker(w, WORKER);
    const orderId = await createOrder(w, { todoId: 'todo-a' });
    const job = await claim(w);
    await w.runtime.call('submitCommand', {
      workerId: WORKER,
      orderId,
      commandId: 's-dry',
      epoch: job.epoch,
      command: { type: 'StartCycle', baseCommit: COMMIT },
    });
    const before = (await w.events.load(orderId)).length;

    const dry = await w.runtime.call('submitCommand', {
      workerId: WORKER,
      orderId,
      commandId: 'c-dry',
      epoch: job.epoch,
      command: {
        type: 'CompleteCycle',
        cycleId: job.station?.cycleId as CycleId,
        artifacts: { plan: await artifactOf(w, '# Plan\n') },
        commit: COMMIT,
      },
      dryRun: true,
    });

    expect(dry.dryRun).toBe(true);
    expect(dry.events.map((event) => event.type)).toContain('cycle_completed');
    expect(dry.next).toBeNull();
    expect((await w.events.load(orderId)).length).toBe(before);
    expect(await w.events.response('c-dry')).toBeUndefined();
  });

  it('a conflict is retried three times, then the caller gets unavailable', async () => {
    const w = world();
    const orderId = await createOrder(w, { todoId: 'todo-a' });
    let attempts = 0;
    const conflicting = {
      ...w.ports,
      events: {
        ...w.events,
        transaction: <T>(fn: (tx: StoreTxLike) => Promise<T>): Promise<T> =>
          w.events.transaction((tx) => {
            attempts += 1;
            return fn({
              load: tx.load,
              append: async () => ({
                kind: 'conflict' as const,
                currentSeq: 0,
              }),
            });
          }),
      },
    };
    const handler = createCommandHandler(
      conflicting as unknown as RuntimePorts,
      () => undefined,
    );

    const error = await handler
      .submit({
        orderId,
        commandId: 'reprioritise-conflict',
        command: { type: 'Reprioritise', priority: 'high' },
        actor: { kind: 'supervisor', name: 'tester' },
      })
      .catch((caught: unknown) => caught);

    expect(attempts).toBe(3);
    expect((error as RuntimeError).wire).toEqual({ code: 'unavailable' });
  });

  it('two commands on one order run in arrival order without a conflict', async () => {
    const w = world();
    const orderId = await createOrder(w, { todoId: 'todo-a' });
    let conflicts = 0;
    const counting = {
      ...w.ports,
      events: {
        ...w.events,
        transaction: <T>(fn: (tx: StoreTxLike) => Promise<T>): Promise<T> =>
          w.events.transaction((tx) =>
            fn({
              load: tx.load,
              append: async (input) => {
                const result = await tx.append(input);
                if (result.kind === 'conflict') conflicts += 1;
                return result;
              },
            }),
          ),
      },
    };
    const handler = createCommandHandler(
      counting as unknown as RuntimePorts,
      () => undefined,
    );
    const actor = { kind: 'supervisor' as const, name: 'a' };

    await Promise.all([
      handler.submit({
        orderId,
        commandId: 'r-1',
        command: { type: 'Reprioritise', priority: 'high' },
        actor,
      }),
      handler.submit({
        orderId,
        commandId: 'r-2',
        command: { type: 'Reprioritise', priority: 'low' },
        actor,
      }),
    ]);

    const seqs = (await w.events.load(orderId)).map((stored) => stored.seq);
    expect(conflicts).toBe(0);
    expect(seqs).toEqual(seqs.map((_seq, index) => index + 1));
  });

  it('a write without the writer lock is rejected and nothing is appended', async () => {
    const w = world();
    const orderId = await createOrder(w, { todoId: 'todo-a' });
    const before = (await w.events.load(orderId)).length;
    w.writer.held = false;

    await expect(
      w.runtime.call('nudge', {
        orderId,
        commandId: 'nudge-no-lock',
        text: 'hello',
      }),
    ).rejects.toThrow(/writer lock is not held/);
    expect((await w.events.load(orderId)).length).toBe(before);
  });
});

describe('claims', () => {
  it('claims the best queued job for a Worker and leases it', async () => {
    const w = world();
    await helloWorker(w, WORKER);
    await createOrder(w, { todoId: 'todo-low', priority: 'low' });
    await createOrder(w, { todoId: 'todo-high', priority: 'high' });

    const job = await claim(w);

    expect(job.orderId).toBe('software-factory:todo-high');
    expect(job.station?.stationId).toBe('plan');
    expect(job.epoch).toBe(1);
    expect(
      (await w.leases.forWorker(WORKER)).map((lease) => lease.orderId),
    ).toEqual(['software-factory:todo-high']);
  });

  it('a Worker with no free slot is offered nothing', async () => {
    const w = world();
    await helloWorker(w, WORKER, 1);
    await createOrder(w, { todoId: 'todo-a' });
    await createOrder(w, { todoId: 'todo-b' });
    await claim(w);

    const response = await w.runtime.call('claim', {
      workerId: WORKER,
      waitMs: 0,
    });

    expect(response.job).toBeNull();
  });

  it('the long-poll answers none at 25 s when nothing is queued', async () => {
    const w = world();
    await helloWorker(w, WORKER);
    let settled: unknown;
    void w.runtime
      .call('claim', { workerId: WORKER, waitMs: 25_000 })
      .then((value) => {
        settled = value;
      });
    await flush();

    w.timers.advance(24_000);
    await flush();
    expect(settled).toBeUndefined();

    w.timers.advance(1_000);
    await flush();
    expect(settled).toEqual({ job: null });
  });

  it('the long-poll wakes early when a Work order arrives', async () => {
    const w = world();
    await helloWorker(w, WORKER);
    let settled: { job: Job | null } | undefined;
    void w.runtime
      .call('claim', { workerId: WORKER, waitMs: 25_000 })
      .then((value) => {
        settled = value;
      });
    await flush();

    await createOrder(w, { todoId: 'todo-late' });
    await flush();

    expect(settled?.job?.orderId).toBe('software-factory:todo-late');
  });
});

describe('continuation', () => {
  it('returns no next job when the Worker cannot run the next station', async () => {
    const w = world();
    // The plan Station runs on `claude`; the plan review runs on `cursor`, which this Worker lacks.
    await helloWorker(w, WORKER, 1, ['claude']);
    const orderId = await createOrder(w, { todoId: 'todo-a' });
    const job = await claim(w);

    const result = await runPlanStation(w, job, {
      start: 's-cont',
      complete: 'c-cont',
    });

    expect(
      result.events.some((event) => event.type === 'cycle_completed'),
    ).toBe(true);
    expect(result.next).toBeNull();
    expect(await w.leases.forWorker(WORKER)).toEqual([]);
    expect(orderId).toBe('software-factory:todo-a');
  });
});
