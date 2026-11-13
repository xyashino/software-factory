import type { ClockPort } from '../ports/clock.port';

/** A clock that only moves when the test says so. */
export class FakeClock implements ClockPort {
  private time: number;

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  set(time: number): void {
    this.time = time;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}
