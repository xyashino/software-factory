/** The Factory clock, in milliseconds. The core never reads time itself. */
export interface Clock {
  now(): number;
}
