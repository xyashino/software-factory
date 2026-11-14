import { describe, expect, it, vi } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import { MAX_CLAIM_WAIT_MS } from '@repo/factory-core/contracts/cell';
import type { CellId, JobId } from '@repo/factory-core/ids';
import { createJobRegistry } from '../jobs/registry';
import { runSlot } from '../loops/claim';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB_ID = '01J0000000000000000000000J' as JobId;

/** A minimal job: the slot loop only reads its id. */
const jobNamed = (jobId: JobId): Job => ({ jobId }) as unknown as Job;

/**
 * A slot driven step by step: each claim answers from the script, and the loop stops after the script
 * runs out. The pause does not wait; it counts.
 */
const scriptedSlot = (answers: (Job | null | Error)[]) => {
  const claims: number[] = [];
  const routes: string[] = [];
  let index = 0;
  let pauses = 0;
  let stopped = false;
  const client = {
    call: vi.fn(async (route: string, request: unknown) => {
      routes.push(route);
      claims.push((request as { waitMs: number }).waitMs);
      const answer = answers[index];
      index += 1;
      if (index >= answers.length) stopped = true;
      if (answer instanceof Error) throw answer;
      return { job: answer ?? null };
    }),
  };
  return {
    client: client as unknown as FactoryClient,
    claims,
    routes,
    pauses: () => pauses,
    sleep: async () => {
      pauses += 1;
    },
    isStopped: () => stopped,
  };
};

describe('claim loop', () => {
  it('claims with the long-poll wait and runs the job it gets', async () => {
    const registry = createJobRegistry();
    const slot = scriptedSlot([jobNamed(JOB_ID), null]);
    const ran: JobId[] = [];

    await runSlot({
      client: slot.client,
      cellId: CELL,
      registry,
      isFenced: () => false,
      isStopped: slot.isStopped,
      waitMs: MAX_CLAIM_WAIT_MS,
      idlePauseMs: 1,
      sleep: slot.sleep,
      runJob: async (job) => {
        ran.push(job.jobId);
      },
    });

    expect(slot.routes[0]).toBe('claim');
    expect(slot.claims[0]).toBe(MAX_CLAIM_WAIT_MS);
    expect(ran).toEqual([JOB_ID]);
  });

  it('holds the job in the registry only while it runs', async () => {
    const registry = createJobRegistry();
    const slot = scriptedSlot([jobNamed(JOB_ID), null]);
    let heldWhileRunning: JobId[] = [];

    await runSlot({
      client: slot.client,
      cellId: CELL,
      registry,
      isFenced: () => false,
      isStopped: slot.isStopped,
      waitMs: 0,
      idlePauseMs: 1,
      sleep: slot.sleep,
      runJob: async () => {
        heldWhileRunning = registry.activeJobIds();
      },
    });

    expect(heldWhileRunning).toEqual([JOB_ID]);
    expect(registry.activeJobIds()).toEqual([]);
  });

  it('frees the slot for another claim after its job ends, even when the job fails', async () => {
    const registry = createJobRegistry();
    const slot = scriptedSlot([jobNamed(JOB_ID), jobNamed(JOB_ID), null]);
    const onError = vi.fn();
    let runs = 0;

    await runSlot({
      client: slot.client,
      cellId: CELL,
      registry,
      isFenced: () => false,
      isStopped: slot.isStopped,
      waitMs: MAX_CLAIM_WAIT_MS,
      idlePauseMs: 1,
      sleep: slot.sleep,
      runJob: async () => {
        runs += 1;
        throw new Error('the job broke');
      },
      onError,
    });

    expect(runs).toBe(2);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('claims nothing while the Cell is fenced', async () => {
    const registry = createJobRegistry();
    const slot = scriptedSlot([null]);
    let fenceChecks = 0;

    await runSlot({
      client: slot.client,
      cellId: CELL,
      registry,
      // Fenced for the first two checks, then open.
      isFenced: () => {
        fenceChecks += 1;
        return fenceChecks <= 2;
      },
      isStopped: () => slot.claims.length >= 1,
      waitMs: MAX_CLAIM_WAIT_MS,
      idlePauseMs: 1,
      sleep: slot.sleep,
      runJob: async () => undefined,
    });

    expect(slot.pauses()).toBe(2);
    expect(slot.claims).toHaveLength(1);
  });

  it('backs off after a failed claim and tries again', async () => {
    const registry = createJobRegistry();
    const slot = scriptedSlot([new Error('socket closed'), null]);
    const onError = vi.fn();

    await runSlot({
      client: slot.client,
      cellId: CELL,
      registry,
      isFenced: () => false,
      isStopped: slot.isStopped,
      waitMs: MAX_CLAIM_WAIT_MS,
      idlePauseMs: 1,
      sleep: slot.sleep,
      runJob: async () => undefined,
      onError,
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'claim');
    expect(slot.pauses()).toBeGreaterThanOrEqual(1);
    expect(slot.claims).toHaveLength(2);
  });
});
