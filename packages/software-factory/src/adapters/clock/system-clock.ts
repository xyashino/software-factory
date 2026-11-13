import type { ClockPort } from '../../ports/clock.port';

export const systemClock: ClockPort = {
  now: () => Date.now(),
};
