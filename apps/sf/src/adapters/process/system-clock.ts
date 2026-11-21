import type { ClockPort } from '../../application/ports/clock.port';

export const createSystemClock = (): ClockPort => ({
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
