import { CLAIM_WAIT_MS } from '../../config';

const HEARTBEAT_FAILURE_LIMIT = 4;

export type NextStep<T> =
  { kind: 'run'; job: T } | { kind: 'claim'; waitMs: number };

export type HeartbeatVerdict = 'continue' | 'abort';

export type OperatorOutcome =
  | { kind: 'done' }
  | { kind: 'verdict'; outcome: 'pass' }
  | { kind: 'verdict'; outcome: 'fail'; feedback: string }
  | { kind: 'block'; reason: string; handover: string };

export const nextStep = <T>(job: T | null): NextStep<T> =>
  job === null
    ? { kind: 'claim', waitMs: CLAIM_WAIT_MS }
    : { kind: 'run', job };

export const heartbeatVerdict = (
  failures: number,
  signals: readonly string[],
): HeartbeatVerdict =>
  signals.includes('abort') || failures >= HEARTBEAT_FAILURE_LIMIT
    ? 'abort'
    : 'continue';
