import type { ClockPort } from '../../application/ports/clock.port';

export const createSystemClock = (): ClockPort => ({
  now: () => Date.now(),
});
