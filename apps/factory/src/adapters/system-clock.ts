import type { ClockPort } from '../ports';

export const createSystemClock = (): ClockPort => ({
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
