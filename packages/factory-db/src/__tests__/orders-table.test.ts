import { describe, expect, it } from 'vitest';
import { SCENARIO_FIXTURES, fixtureEvents } from '@repo/factory-core/testing';
import { orderRowOf, projectionOfRow } from '../orders-table';
import { foldAll, projectRow } from './helpers';

describe('the orders row mapping', () => {
  it.each(SCENARIO_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    'maps the projection of %s to a row and back unchanged',
    (_name, fixture) => {
      const events = fixtureEvents(fixture);
      const last = events[events.length - 1];
      if (!last) throw new Error('a fixture has events');
      const projection = projectRow(foldAll(events), {
        lastSeq: last.seq,
        createdAt: events[0]?.at ?? 0,
        updatedAt: last.at,
      });

      expect(projectionOfRow(orderRowOf(projection))).toEqual(projection);
    },
  );

  it('maps the cell columns to lastCellId and avoidCells', () => {
    const events = fixtureEvents(SCENARIO_FIXTURES[0]!);
    const last = events[events.length - 1]!;
    const row = orderRowOf(
      projectRow(foldAll(events), {
        lastSeq: last.seq,
        createdAt: 0,
        updatedAt: last.at,
      }),
    );

    expect(Object.keys(row)).toEqual(
      expect.arrayContaining(['lastCellId', 'avoidCells']),
    );
    expect(row.progressed).toBe(1);
  });
});
