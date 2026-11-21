import { z } from 'zod';
import type { LocalSlot } from '../../../domain/cell/local-slot';
import { define } from '../../core/procedure';
import { type CellRow, listCells } from './list.procedure';
import { livePidOf } from './local-pid';

const EmptySchema = z.object({}).strict();

export interface LocalSlotRow extends Omit<LocalSlot, 'pid'> {
  pid: number | null;
}

export interface CellWithPidRow extends CellRow {
  pid: number | null;
}

export const listLocalSlots = define({ kind: 'supervisor' })(EmptySchema)<
  LocalSlotRow[]
>(async (_input, ctx) =>
  (await ctx.localSlots.read()).map((slot) => ({
    ...slot,
    pid: livePidOf(ctx, slot),
  })),
);

export const listCellsWithLocal = define({ kind: 'supervisor' })(EmptySchema)<
  CellWithPidRow[]
>(async (_input, ctx) => {
  const { rows } = await listCells.execute({}, ctx);
  const slots = await ctx.localSlots.read();
  return rows.map((row) => {
    const slot = slots.find(
      (candidate) =>
        candidate.name === row.name && candidate.state === 'running',
    );
    return {
      ...row,
      pid: slot === undefined ? null : livePidOf(ctx, slot),
    };
  });
});
