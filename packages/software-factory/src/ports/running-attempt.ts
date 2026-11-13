import type { FactoryEvent } from '../engine/events';
import type { AttemptLookup } from './store.port';

const TERMINAL: ReadonlySet<FactoryEvent['type']> = new Set([
  'completed',
  'verdict',
  'gate_finished',
  'attempt_failed',
]);

/**
 * Whether an attempt is still running, judged from the events of one task alone.
 * Shared by every store so the in-pane CLI gets the same answer from any adapter.
 */
export const findRunningAttempt = (
  events: readonly { event: FactoryEvent }[],
  attemptId: string,
): AttemptLookup | undefined => {
  let started: AttemptLookup | undefined;
  let running = false;
  for (const { event } of events) {
    if (event.type === 'attempt_started' && event.attemptId === attemptId) {
      started = { attemptId, stepId: event.stepId, n: event.n };
      running = true;
    } else if ('attemptId' in event && event.attemptId === attemptId) {
      if (event.type === 'agent_ready') continue;
      if (TERMINAL.has(event.type)) running = false;
    }
  }
  return running ? started : undefined;
};
