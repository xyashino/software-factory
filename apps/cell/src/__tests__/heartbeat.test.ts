import { describe, expect, it, vi } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type {
  HeartbeatResponse,
  Signal,
} from '@repo/factory-core/contracts/cell';
import type { CellId, JobId } from '@repo/factory-core/ids';
import { createJobRegistry } from '../jobs/registry';
import { createHeartbeat } from '../loops/heartbeat';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const SELF_FENCE_MS = 45_000;

/** A clock the test moves by hand. */
const manualClock = () => {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

/** A client whose heartbeat answers come from the script; `null` means the socket is unreachable. */
const scriptedBeats = (...answers: (HeartbeatResponse | null)[]) => {
  const calls: { route: string; jobs: JobId[]; acked: string[] }[] = [];
  let index = 0;
  const client = {
    call: vi.fn(async (route: string, request: unknown) => {
      const sent = request as { jobs: JobId[]; acked: string[] };
      calls.push({ route, jobs: sent.jobs, acked: sent.acked });
      const answer = answers[Math.min(index, answers.length - 1)];
      index += 1;
      if (answer === null || answer === undefined) {
        throw new Error('socket unreachable');
      }
      return answer;
    }),
  };
  return { client: client as unknown as FactoryClient, calls };
};

const okBeat = (
  signals: Signal[] = [],
  stale: JobId[] = [],
): HeartbeatResponse => ({
  jobs: [...stale.map((jobId) => ({ jobId, status: 'stale' as const }))],
  signals,
});

describe('heartbeat loop', () => {
  it('sends every held job id in one beat', async () => {
    const clock = manualClock();
    const registry = createJobRegistry();
    registry.start(JOB);
    const { client, calls } = scriptedBeats(okBeat());
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: SELF_FENCE_MS,
    });

    await heartbeat.tick();

    expect(calls[0]?.jobs).toEqual([JOB]);
  });

  it('aborts a job the Factory reports stale', async () => {
    const clock = manualClock();
    const registry = createJobRegistry();
    const { signal } = registry.start(JOB);
    const { client } = scriptedBeats(okBeat([], [JOB]));
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: SELF_FENCE_MS,
    });

    await heartbeat.tick();

    expect(signal.aborted).toBe(true);
    expect(registry.abortReason(JOB)).toMatch(/stale/);
  });

  it('hands a signal to its job, then acknowledges it on the next beat', async () => {
    const clock = manualClock();
    const registry = createJobRegistry();
    registry.start(JOB);
    const signal: Signal = {
      signalId: 's1',
      jobId: JOB,
      kind: 'nudge',
      text: 'x',
    };
    const { client, calls } = scriptedBeats(okBeat([signal]), okBeat());
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: SELF_FENCE_MS,
    });

    await heartbeat.tick();
    expect(registry.takeSignals(JOB)).toEqual([signal]);
    await heartbeat.tick();

    expect(calls[0]?.acked).toEqual([]);
    expect(calls[1]?.acked).toEqual(['s1']);
  });

  it('does not hand the same signal to its job twice when a beat was lost', async () => {
    const clock = manualClock();
    const registry = createJobRegistry();
    registry.start(JOB);
    const signal: Signal = {
      signalId: 's1',
      jobId: JOB,
      kind: 'nudge',
      text: 'x',
    };
    // The second beat fails, so its ack is lost; the third beat sees the signal again.
    const { client } = scriptedBeats(okBeat([signal]), null, okBeat([signal]));
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: SELF_FENCE_MS,
    });

    await heartbeat.tick();
    await heartbeat.tick();
    await heartbeat.tick();

    expect(registry.takeSignals(JOB)).toEqual([signal]);
  });
});

describe('self-fence', () => {
  it('aborts every job and pauses claims once no beat succeeded for 45 s', async () => {
    const clock = manualClock();
    const registry = createJobRegistry();
    const { signal } = registry.start(JOB);
    const { client } = scriptedBeats(null);
    const onFence = vi.fn();
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: SELF_FENCE_MS,
      onFence,
    });

    clock.advance(SELF_FENCE_MS - 1_000);
    await heartbeat.tick();
    expect(heartbeat.fenced).toBe(false);
    expect(signal.aborted).toBe(false);

    clock.advance(1_000);
    await heartbeat.tick();

    expect(heartbeat.fenced).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(onFence).toHaveBeenCalledTimes(1);
  });

  it('fences on the check alone, without waiting for the next beat', async () => {
    const clock = manualClock();
    const registry = createJobRegistry();
    const { signal } = registry.start(JOB);
    const { client } = scriptedBeats(okBeat());
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: SELF_FENCE_MS,
    });
    await heartbeat.tick();

    clock.advance(SELF_FENCE_MS);
    heartbeat.checkFence();

    expect(heartbeat.fenced).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it('resumes claims once a beat succeeds again', async () => {
    const clock = manualClock();
    const registry = createJobRegistry();
    const { client } = scriptedBeats(null, okBeat());
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry,
      clock,
      selfFenceMs: SELF_FENCE_MS,
    });
    clock.advance(SELF_FENCE_MS);
    await heartbeat.tick();
    expect(heartbeat.fenced).toBe(true);

    await heartbeat.tick();

    expect(heartbeat.fenced).toBe(false);
  });
});
