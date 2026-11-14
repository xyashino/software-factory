import { describe, expect, it } from 'vitest';
import { SCENARIO_FIXTURES, fixtureEvents } from '@repo/factory-core/testing';
import { rebuildProjections } from '../rebuild-projections';
import {
  appendHistory,
  appendPlanHistory,
  openSeededStore,
  planEvents,
  projectRow,
  rawPlans,
} from './helpers';

describe('rebuilding the plans projection (CORE §12.3, STORAGE §6)', () => {
  it.each(SCENARIO_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    'gives the same orders and plans tables, byte for byte, after a rebuild with a plan beside %s',
    async (_name, fixture) => {
      const { db, store } = openSeededStore();
      await appendHistory(store, fixtureEvents(fixture));
      await appendPlanHistory(store, planEvents());
      const ordersBefore = db
        .query('SELECT * FROM orders ORDER BY order_id')
        .all();
      const plansBefore = rawPlans(db);

      await rebuildProjections(store, projectRow);

      expect(db.query('SELECT * FROM orders ORDER BY order_id').all()).toEqual(
        ordersBefore,
      );
      expect(rawPlans(db)).toBe(plansBefore);
      expect(plansBefore).toContain('"phase":"active"');
    },
  );

  it('restores a blanked plan row from its events, and gives the same table when rebuilt twice', async () => {
    const { db, store } = openSeededStore();
    await appendPlanHistory(store, planEvents());
    const written = rawPlans(db);
    db.run(
      "UPDATE plans SET phase = 'cancelled', last_seq = 0, holder = 'none'",
    );

    await rebuildProjections(store, projectRow);
    expect(rawPlans(db)).toBe(written);
    await rebuildProjections(store, projectRow);
    expect(rawPlans(db)).toBe(written);
  });
});
