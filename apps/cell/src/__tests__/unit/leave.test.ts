import { describe, expect, it } from 'vitest';
import { leaveCell, onLeaveSignal } from '../../leave';
import { createRegistry, type RunHandle } from '../../cycle/registry';

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
