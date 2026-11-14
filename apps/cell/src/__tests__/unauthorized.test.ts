import { describe, expect, it, vi } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import { MAX_CLAIM_WAIT_MS } from '@repo/factory-core/contracts/cell';
import type { CellId, JobId } from '@repo/factory-core/ids';
import { createJobRegistry } from '../jobs/registry';
import { runSlot } from '../loops/claim';
import { createHeartbeat } from '../loops/heartbeat';
import { isUnauthorized } from '../remote-client';

const CELL = '01J0000000000000000000000W' as CellId;

const refused = (): WireFailure => new WireFailure({ code: 'unauthorized' });

/** A clock that stays put: the heartbeat's fence is not under test here. */
const manualClock = () => ({ now: () => 1_000_000 });

/** A client whose every call throws the given error, and that counts its calls. */
const failingClient = (error: unknown) => {
  const call = vi.fn(async () => {
    throw error;
  });
  return { client: { call } as unknown as FactoryClient, call };
};

describe('isUnauthorized', () => {
  it('is true only for a refused credential', () => {
    expect(isUnauthorized(refused())).toBe(true);
    expect(isUnauthorized(new WireFailure({ code: 'unavailable' }))).toBe(
      false,
    );
    expect(isUnauthorized(new Error('unauthorized'))).toBe(false);
  });
});

describe('a refused credential on the claim loop', () => {
  it('stops the slot at once, runs no job, and reports it instead of retrying', async () => {
    const { client, call } = failingClient(refused());
    const onUnauthorized = vi.fn();
    const onError = vi.fn();
    const ran: JobId[] = [];

    await runSlot({
      client,
      cellId: CELL,
      registry: createJobRegistry(),
      isFenced: () => false,
      isStopped: () => false,
      waitMs: MAX_CLAIM_WAIT_MS,
      idlePauseMs: 1,
      sleep: async () => undefined,
      runJob: async (job: Job) => {
        ran.push(job.jobId);
      },
      onError,
      onUnauthorized,
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(ran).toEqual([]);
  });

  it('keeps retrying an ordinary claim failure, as before', async () => {
    const { client, call } = failingClient(
      new WireFailure({ code: 'unavailable' }),
    );
    const onUnauthorized = vi.fn();
    let stopped = false;

    await runSlot({
      client,
      cellId: CELL,
      registry: createJobRegistry(),
      isFenced: () => false,
      isStopped: () => {
        if (call.mock.calls.length >= 2) stopped = true;
        return stopped;
      },
      waitMs: MAX_CLAIM_WAIT_MS,
      idlePauseMs: 1,
      sleep: async () => undefined,
      runJob: async () => undefined,
      onUnauthorized,
    });

    expect(call.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('a refused credential on the heartbeat', () => {
  it('reports the refusal, and an ordinary failed beat does not', async () => {
    const clock = manualClock();
    const registry = createJobRegistry();

    const refusedBeat = vi.fn();
    const refusing = failingClient(refused());
    await createHeartbeat({
      client: refusing.client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: 45_000,
      onUnauthorized: refusedBeat,
    }).tick();

    const otherBeat = vi.fn();
    const unreachable = failingClient(new WireFailure({ code: 'unavailable' }));
    await createHeartbeat({
      client: unreachable.client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: 45_000,
      onUnauthorized: otherBeat,
    }).tick();

    expect(refusedBeat).toHaveBeenCalledTimes(1);
    expect(otherBeat).not.toHaveBeenCalled();
  });
});
