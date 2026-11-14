import { describe, expect, it, vi } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import { MAX_CLAIM_WAIT_MS } from '@repo/factory-core/contracts/cell';
import type { CellId, JobId } from '@repo/factory-core/ids';
import { createJobRegistry } from '../jobs/registry';
import { runSlot } from '../loops/claim';

const CELL = '01J0000000000000000000000W' as CellId;
const FIRST = '01J0000000000000000000000A' as JobId;
const NEXT = '01J0000000000000000000000B' as JobId;

const jobNamed = (jobId: JobId): Job => ({ jobId }) as unknown as Job;

/**
 * The Factory answers a job-ending command with its continuation (PROTOCOL §4): the job of the same
 * Work order that this Cell claimed in the same step. The Cell has to run that job itself; a claim
 * would give it some other job, and the continuation would expire on its lease.
 */
describe('a job that ends with a continuation', () => {
  it('runs the continuation in the same slot, before it claims again', async () => {
    const claimed: JobId[] = [];
    const ran: JobId[] = [];
    let stopped = false;
    const client = {
      call: vi.fn(async () => {
        if (claimed.length === 0) {
          claimed.push(FIRST);
          return { job: jobNamed(FIRST) };
        }
        // The first claim is the only one this test expects: any later claim ends the slot.
        claimed.push('claimed-again' as JobId);
        stopped = true;
        return { job: null };
      }),
    };

    await runSlot({
      client: client as unknown as FactoryClient,
      cellId: CELL,
      registry: createJobRegistry(),
      isFenced: () => false,
      isStopped: () => stopped,
      waitMs: MAX_CLAIM_WAIT_MS,
      idlePauseMs: 1,
      sleep: async () => undefined,
      runJob: async (job) => {
        ran.push(job.jobId);
        return job.jobId === FIRST ? jobNamed(NEXT) : null;
      },
    });

    expect(ran).toEqual([FIRST, NEXT]);
  });

  it('is released at once when the Cell is leaving, so the Work order goes back to the queue', async () => {
    const commands: { command: { type: string }; jobId: string }[] = [];
    let leaving = false;
    const client = {
      call: vi.fn(async (route: string, request: unknown) => {
        if (route === 'submitCommand') {
          commands.push(request as (typeof commands)[number]);
          return { dryRun: false, events: [], next: null };
        }
        return { job: jobNamed(FIRST) };
      }),
    };

    await runSlot({
      client: client as unknown as FactoryClient,
      cellId: CELL,
      registry: createJobRegistry(),
      isFenced: () => false,
      isStopped: () => leaving,
      waitMs: MAX_CLAIM_WAIT_MS,
      idlePauseMs: 1,
      sleep: async () => undefined,
      runJob: async (job) => {
        // The Cell is told to leave while the job runs; the job ends and hands back its continuation.
        leaving = true;
        return job.jobId === FIRST ? jobNamed(NEXT) : null;
      },
    });

    expect(commands).toEqual([
      expect.objectContaining({
        jobId: NEXT,
        command: { type: 'ReleaseJob' },
      }),
    ]);
  });
});
