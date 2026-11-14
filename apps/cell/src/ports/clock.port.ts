/** Wall clock in milliseconds. Injected so tests control time. */
export interface ClockPort {
  now(): number;
}
