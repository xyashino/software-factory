import type { RuntimeCycle } from '@repo/factory-core/cycle/watch';

/**
 * The question hold (CORE §9.2): while a question is open the Cycle is parked. Opening the hold
 * stamps `pausedSince`; closing it adds the held time to `pausedMs`, which the watch never counts.
 * Both return a new cycle; the input is not changed.
 */
export const openHold = (cycle: RuntimeCycle, now: number): RuntimeCycle =>
  cycle.pausedSince === undefined ? { ...cycle, pausedSince: now } : cycle;

export const closeHold = (cycle: RuntimeCycle, now: number): RuntimeCycle => {
  if (cycle.pausedSince === undefined) return cycle;
  const { pausedSince, ...rest } = cycle;
  return { ...rest, pausedMs: cycle.pausedMs + (now - pausedSince) };
};

/** True once a hold has run for at least `holdMs`: the Cell then asks for a Handover. */
export const holdDue = (
  cycle: RuntimeCycle,
  now: number,
  holdMs: number,
): boolean =>
  cycle.pausedSince !== undefined && now - cycle.pausedSince >= holdMs;
