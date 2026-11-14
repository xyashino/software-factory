import { describe, expect, it } from 'vitest';
import {
  observePane,
  startPaneClock,
  tickPaneClock,
} from '../../cycle/observe';

describe('pane observation', () => {
  it('starts its output clock at the Cycle start, with no tail seen yet', () => {
    expect(startPaneClock(1_000)).toEqual({ tail: '', outputAt: 1_000 });
  });

  it('moves the output clock to now only when the visible tail changed', () => {
    const started = startPaneClock(1_000);
    const first = tickPaneClock(started, 'thinking', 2_000);
    const same = tickPaneClock(first, 'thinking', 3_000);
    const changed = tickPaneClock(same, 'wrote a file', 4_000);

    expect(first.outputAt).toBe(2_000);
    expect(same.outputAt).toBe(2_000);
    expect(changed.outputAt).toBe(4_000);
  });

  it('reports the status Herdr gave with the pane output clock', () => {
    const clock = tickPaneClock(startPaneClock(1_000), 'x', 2_500);

    expect(observePane({ operator: 'working' }, clock)).toEqual({
      operator: 'working',
      lastOutputAt: 2_500,
    });
    expect(observePane({ operator: 'blocked' }, clock).operator).toBe(
      'blocked',
    );
    expect(observePane({ operator: 'gone' }, clock).operator).toBe('gone');
  });
});
