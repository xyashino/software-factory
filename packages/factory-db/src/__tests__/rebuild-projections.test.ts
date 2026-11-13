import { describe, expect, it } from 'vitest';
import { SCENARIO_FIXTURES, fixtureEvents } from '@repo/factory-core/testing';
import { rebuildProjections } from '../rebuild-projections';
import {
  appendHistory,
  openSeededStore,
  projectRow,
  rawOrders,
} from './helpers';

describe('rebuilding the orders projection', () => {
  it.each(SCENARIO_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    'gives the same orders table, byte for byte, after a rebuild of %s',
    async (_name, fixture) => {
      const { db, store } = openSeededStore();
      await appendHistory(store, fixtureEvents(fixture));
      const written = rawOrders(db);

      await rebuildProjections(store, projectRow);

      expect(rawOrders(db)).toBe(written);
      expect(written).not.toBe('[]');
    },
  );

  it('restores a blanked orders row from the events', async () => {
    const { db, store } = openSeededStore();
    await appendHistory(store, fixtureEvents(SCENARIO_FIXTURES[0]!));
    const written = rawOrders(db);
    db.run(
      "UPDATE orders SET title = 'corrupted', last_seq = 0, status = 'andon'",
    );

    await rebuildProjections(store, projectRow);

    expect(rawOrders(db)).toBe(written);
  });

  it('removes a row that has no events behind it', async () => {
    const { db, store } = openSeededStore();
    await appendHistory(store, fixtureEvents(SCENARIO_FIXTURES[0]!));
    const written = rawOrders(db);
    db.run(
      `INSERT INTO orders (order_id, project_id, todo_id, title, line, priority, depends_on, last_seq, status, holder, next_kind, progressed, resumed, created_at, updated_at)
       VALUES ('software-factory:ghost', 'software-factory', 'ghost', 'ghost', 'factory-default', 'low', '[]', 1, 'queued', 'queue', 'done', 0, 0, 0, 0)`,
    );

    const rows = await rebuildProjections(store, projectRow);

    expect(rows).toBe(1);
    expect(rawOrders(db)).toBe(written);
  });

  it('gives the same table when rebuilt twice', async () => {
    const { db, store } = openSeededStore();
    await appendHistory(store, fixtureEvents(SCENARIO_FIXTURES[1]!));

    await rebuildProjections(store, projectRow);
    const once = rawOrders(db);
    await rebuildProjections(store, projectRow);

    expect(rawOrders(db)).toBe(once);
  });
});
