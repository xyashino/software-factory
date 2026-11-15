import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { incidentsOf } from '../render/order';

const stored = (event: unknown): StoredEvent => event as StoredEvent;

describe('incidentsOf', () => {
  it('lists each incident with its action, its changes and its outcome', () => {
    const lines = incidentsOf([
      stored({
        event: {
          type: 'andon_raised',
          reason: 'cycle_blocked',
          detail: 'blocked',
        },
      }),
      stored({
        event: {
          type: 'incident_recorded',
          incidentId: 'I01M7FH3Z4M5N57X5YS6WNG6HY',
          by: 'mechanic',
          andonAt: 1000,
          andonReason: 'cycle_blocked',
          diagnosis: 'the trust screen blocked the pane',
          action: { kind: 'repair' },
          changes: [
            { kind: 'config', path: 'runners/claude.json', ref: 'sha256:abc' },
          ],
          outcome: 'the Work order resumed',
        },
      }),
    ]);

    expect(lines).toEqual([
      'incident I01M7FH3  cycle_blocked  repair by mechanic',
      '  diagnosis the trust screen blocked the pane',
      '  config runners/claude.json = sha256:abc',
      '  outcome   the Work order resumed',
    ]);
  });

  it('is empty when no incident was recorded', () => {
    expect(
      incidentsOf([stored({ event: { type: 'cancelled', reason: 'x' } })]),
    ).toEqual([]);
  });
});
