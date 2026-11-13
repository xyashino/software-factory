/** The Factory clock, in milliseconds. The core never reads time itself (RULES §1.1). */
export interface Clock {
  now(): number;
}
