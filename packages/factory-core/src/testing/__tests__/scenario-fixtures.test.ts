import { describe, expect, it } from 'vitest';
import { evolve } from '../../order/evolve';
import { SCENARIO_FIXTURES, fixtureEvents } from '../scenario-fixtures';

describe('the scenario fixtures', () => {
  it('has a name for every fixture, once', () => {
    const names = SCENARIO_FIXTURES.map((fixture) => fixture.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(SCENARIO_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    'folds %s into a Work order',
    (_name, fixture) => {
      const events = fixtureEvents(fixture);
      expect(events.length).toBeGreaterThan(1);
      let state: ReturnType<typeof evolve> | undefined;
      for (const stored of events) {
        state = evolve(state, stored);
      }
      expect(state?.orderId).toBe(events[0]?.orderId);
    },
  );
});
