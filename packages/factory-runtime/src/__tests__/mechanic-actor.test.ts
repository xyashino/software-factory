import { describe, expect, it } from 'vitest';
import type { CellId } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import { actorOfCellCommand } from '../operations';

const CELL = 'cell-a' as CellId;

describe('the actor a Cell command runs as (CORE §14.3)', () => {
  it('runs the incident and the Mechanic follow-ups as the Mechanic', () => {
    const commands: OrderCommand[] = [
      {
        type: 'RecordIncident',
        diagnosis: 'the pane was blocked',
        action: { kind: 'resume' },
        changes: [],
        outcome: 'resumed',
      },
      { type: 'Resume', mode: { kind: 'retry_station' } },
      { type: 'Cancel', reason: 'not recoverable' },
      { type: 'Nudge', text: 'continue' },
    ];
    for (const command of commands) {
      expect(actorOfCellCommand(CELL, command)).toEqual({
        kind: 'mechanic',
        name: 'mechanic',
      });
    }
  });

  it("keeps every other Cell command the Cell's own", () => {
    expect(
      actorOfCellCommand(CELL, { type: 'ClaimJob', cellId: CELL }),
    ).toEqual({ kind: 'cell', cellId: CELL });
  });
});
