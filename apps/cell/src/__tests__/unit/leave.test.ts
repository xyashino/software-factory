import { describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import { leaveCell, onLeaveSignal } from '../../leave';
import { createRegistry, type RunHandle } from '../../cycle/registry';

const planJob = (jobId: string): Job =>
  ({
    jobId,
    epoch: 2,
    kind: 'plan_branch',
    orderId: 'plan_0123456789abcdef',
  }) as unknown as Job;

const handle = (
  jobId: string,
  onLeave: () => void = () => undefined,
): RunHandle => ({
  jobId,
  leave: onLeave,
});

describe('leaving a Cell', () => {
  it('asks every live station to hand over, then waits until they have all ended', async () => {
    const registry = createRegistry();
    const asked: string[] = [];
    const first = handle('j1', () => asked.push('j1'));
    registry.add(first);
    registry.add(handle('j2', () => asked.push('j2')));
    let clock = 0;

    const leaving = leaveCell({
      registry,
      sleep: async (ms) => {
        clock += ms;
        if (clock >= 20) registry.delete(first);
        if (clock >= 40) registry.delete(registry.all()[0] as RunHandle);
      },
      now: () => clock,
      pollMs: 10,
    });

    expect(await leaving).toEqual({ remaining: 0 });
    expect(asked).toEqual(['j1', 'j2']);
  });

  it('returns after the cap with the stations still running, instead of waiting forever', async () => {
    const registry = createRegistry();
    registry.add(handle('stuck'));
    let clock = 0;
    const result = await leaveCell({
      registry,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      pollMs: 100,
      capMs: 1_000,
    });
    expect(result).toEqual({ remaining: 1 });
  });

  it('starts the leave on SIGTERM and exits 0 once every station has ended', async () => {
    const registry = createRegistry();
    const first = handle('j1');
    registry.add(first);
    let listener: (() => void) | undefined;
    const exits: number[] = [];
    let clock = 0;
    onLeaveSignal({
      registry,
      sleep: async (ms) => {
        clock += ms;
        registry.delete(first);
      },
      now: () => clock,
      pollMs: 10,
      on: (signal, next) => {
        expect(signal).toBe('SIGTERM');
        listener = next;
      },
      exit: (code) => exits.push(code),
    });

    listener?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exits).toEqual([0]);
  });

  it('exits 1 when the cap passes with a station still running', async () => {
    const registry = createRegistry();
    registry.add(handle('stuck'));
    let listener: (() => void) | undefined;
    const exits: number[] = [];
    let clock = 0;
    onLeaveSignal({
      registry,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      pollMs: 100_000,
      on: (_signal, next) => {
        listener = next;
      },
      exit: (code) => exits.push(code),
    });

    listener?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exits).toEqual([1]);
  });
});

describe('leaving a Cell that holds plan jobs', () => {
  it('lets a plan job finish within the cap, with no ReleaseJob', async () => {
    const registry = createRegistry();
    let running: Job[] = [planJob('p1')];
    const events: string[] = [];
    let clock = 0;

    const result = await leaveCell({
      registry,
      plans: {
        held: () => running,
        release: async (job) => {
          events.push(`release:${job.jobId}`);
        },
        abort: (job) => {
          events.push(`abort:${job.jobId}`);
        },
      },
      sleep: async (ms) => {
        clock += ms;
        running = [];
      },
      now: () => clock,
      pollMs: 10,
    });

    expect(result).toEqual({ remaining: 0 });
    expect(events).toEqual([]);
  });

  it('releases, then stops, a plan job still running past the cap', async () => {
    const registry = createRegistry();
    const running: Job[] = [planJob('p1')];
    const events: string[] = [];
    let clock = 0;

    const result = await leaveCell({
      registry,
      plans: {
        held: () => running,
        release: async (job) => {
          events.push(`release:${job.jobId}`);
        },
        abort: (job) => {
          events.push(`abort:${job.jobId}`);
        },
      },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      pollMs: 100,
      capMs: 1_000,
    });

    expect(result).toEqual({ remaining: 0 });
    expect(events).toEqual(['release:p1', 'abort:p1']);
    expect(clock).toBeGreaterThanOrEqual(1_000);
  });
});
