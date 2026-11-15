import { describe, expect, it } from 'vitest';
import type {
  BlobRef,
  CellId,
  CommitSha,
  CycleId,
  OrderId,
} from '@repo/factory-core/ids';
import {
  createOrder,
  helloCell,
  sha256Ref,
  world,
  type World,
} from './test-kit';

const CELL = '01J0000000000000000000000W' as CellId;
const COMMIT = 'a'.repeat(40) as CommitSha;

/**
 * Counts the projection and registry reads a command makes. The runtime reads its ports at call time,
 * so wrapping the methods in place counts every read the command loop does.
 */
const countReads = (w: World) => {
  const counts = { orders: 0, plans: 0, projects: 0 };
  const { projections, projects } = w.ports;
  const orders = projections.orders;
  const plans = projections.plans;
  const list = projects.list;
  projections.orders = () => {
    counts.orders += 1;
    return orders();
  };
  projections.plans = () => {
    counts.plans += 1;
    return plans();
  };
  projects.list = () => {
    counts.projects += 1;
    return list();
  };
  return counts;
};

describe('queue reads per command (perf-04)', () => {
  it('a claim reads the orders and the registry twice: once to choose the job, once to build it', async () => {
    const w = world();
    await helloCell(w, CELL, 1, ['claude']);
    await createOrder(w, { todoId: 'todo-a' });
    const counts = countReads(w);

    const claimed = await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });

    expect(claimed.job).not.toBeNull();
    // The queue read that selects the job, then the ClaimJob attempt's single read for the build.
    expect(counts.orders).toBe(2);
    expect(counts.projects).toBe(2);
  });

  it('a continuation reads the orders and the project registry once each, for the whole command', async () => {
    const w = world();
    // The plan Station runs on `claude`, the plan review on `cursor`: CompleteCycle hands the next job on.
    await helloCell(w, CELL, 1, ['claude', 'cursor']);
    const orderId = (await createOrder(w, { todoId: 'todo-a' })) as OrderId;
    const claimed = await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
    const job = claimed.job;
    if (!job?.station?.cycleId) throw new Error('expected a plan job');
    await w.runtime.call('submitCommand', {
      cellId: CELL,
      orderId,
      commandId: 'start-cycle-000000000001',
      epoch: job.epoch,
      command: { type: 'StartCycle', baseCommit: COMMIT },
    });
    const planBytes = new TextEncoder().encode('# Plan\n');
    const plan = sha256Ref('# Plan\n') as BlobRef;
    await w.blobs.put(plan, planBytes, 'text/markdown');
    const counts = countReads(w);

    const result = await w.runtime.call('submitCommand', {
      cellId: CELL,
      orderId,
      commandId: 'complete-cycle-00000001',
      epoch: job.epoch,
      command: {
        type: 'CompleteCycle',
        cycleId: job.station.cycleId as CycleId,
        artifacts: { plan },
        commit: COMMIT,
      },
    });

    expect(result.next).not.toBeNull();
    expect(counts.orders).toBe(1);
    expect(counts.projects).toBe(1);
  });
});
