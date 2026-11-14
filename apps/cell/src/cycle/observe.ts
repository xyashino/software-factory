import { statSync } from 'node:fs';
import type { Observation } from '@repo/factory-core/cycle/watch';
import type { HeadlessProcess, PaneReading } from '../ports';

/**
 * What a headless Operator looks like now (CORE §9.1): alive is working, exited is gone. Its last
 * output is the modification time of its stdout log, or the Cycle start when nothing was printed.
 */
export const observeHeadless = (
  process: HeadlessProcess,
  stdoutPath: string,
  startedAt: number,
): Observation => {
  if (!process.alive()) return { operator: 'gone', lastOutputAt: startedAt };
  let lastOutputAt = startedAt;
  try {
    lastOutputAt = Math.max(startedAt, statSync(stdoutPath).mtimeMs);
  } catch {
    // no output yet: the Cycle start stands
  }
  return { operator: 'working', lastOutputAt };
};

/**
 * The output clock of a pane. A pane writes no log the Cell can stat, so its last output is the last
 * time its visible tail changed: the Cycle start until the first change.
 */
export interface PaneClock {
  readonly tail: string;
  readonly outputAt: number;
}

export const startPaneClock = (startedAt: number): PaneClock => ({
  tail: '',
  outputAt: startedAt,
});

/** Moves the clock to `now` when the tail changed, and keeps it otherwise. */
export const tickPaneClock = (
  clock: PaneClock,
  tail: string,
  now: number,
): PaneClock => (tail === clock.tail ? clock : { tail, outputAt: now });

/** What a Herdr pane looks like now: its reported status, with the output clock of the pane. */
export const observePane = (
  reading: PaneReading,
  clock: PaneClock,
): Observation => ({
  operator: reading.operator,
  lastOutputAt: clock.outputAt,
});
