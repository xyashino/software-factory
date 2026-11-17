import type { ClockPort } from '../../src/application/ports/clock.port';

export type FakeClock = ClockPort & { advance(deltaMs: number): void };

export const createFakeClock = (startMs = 1_700_000_000_000): FakeClock => {
  let current = startMs;
  return {
    now: () => current,
    advance: (deltaMs) => {
      current += deltaMs;
    },
  };
};
