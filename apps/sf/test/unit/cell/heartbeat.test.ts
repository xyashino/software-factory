import { describe, expect, it } from 'vitest';
import { startHeartbeat } from '../../../src/cell/heartbeat';
import type { ClockPort } from '../../../src/application/ports/clock.port';

const INTERVAL_MS = 10_000;

interface ManualClock {
  clock: ClockPort;
  tick: () => Promise<void>;
}

const flush = async (): Promise<void> => {
  for (let round = 0; round < 50; round += 1) {
    await Promise.resolve();
  }
};

const manualClock = (): ManualClock => {
  let wake: (() => void) | undefined;
  return {
    clock: {
      now: () => 0,
      sleep: () =>
        new Promise<void>((resolve) => {
          wake = resolve;
        }),
    },
    tick: async () => {
      const pending = wake;
      wake = undefined;
      pending?.();
      await flush();
    },
  };
};

describe('heartbeat', () => {
  it('aborts the runner after four failed beats in a row', async () => {
    // Arrange
    const timer = manualClock();
    let aborted = 0;
    let beats = 0;
    startHeartbeat({
      clock: timer.clock,
      intervalMs: INTERVAL_MS,
      beat: async () => {
        beats += 1;
        throw new Error('server down');
      },
      onAbort: () => {
        aborted += 1;
      },
    });

    // Act
    for (let round = 0; round < 4; round += 1) {
      await timer.tick();
    }

    // Assert
    expect(beats).toBe(4);
    expect(aborted).toBe(1);
  });

  it('keeps the runner when a failure is followed by a success', async () => {
    // Arrange
    const timer = manualClock();
    let aborted = 0;
    let call = 0;
    startHeartbeat({
      clock: timer.clock,
      intervalMs: INTERVAL_MS,
      beat: async () => {
        call += 1;
        if (call % 2 === 1) {
          throw new Error('blip');
        }
        return [];
      },
      onAbort: () => {
        aborted += 1;
      },
    });

    // Act
    for (let round = 0; round < 8; round += 1) {
      await timer.tick();
    }

    // Assert
    expect(aborted).toBe(0);
  });

  it('aborts the runner at once when the server sends abort', async () => {
    // Arrange
    const timer = manualClock();
    let aborted = 0;
    startHeartbeat({
      clock: timer.clock,
      intervalMs: INTERVAL_MS,
      beat: async () => ['abort'],
      onAbort: () => {
        aborted += 1;
      },
    });

    // Act
    await timer.tick();

    // Assert
    expect(aborted).toBe(1);
  });
});
