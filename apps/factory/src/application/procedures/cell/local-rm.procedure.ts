import { z } from 'zod';
import { findLocalSlot } from '../../../domain/cell/local-slot';
import { Refused } from '../../core/errors';
import { define } from '../../core/procedure';
import { livePidOf } from './local-pid';

const RemoveSchema = z.object({ id: z.string().trim().min(1) }).strict();

export const removeLocalCell = define({ kind: 'supervisor' })(
  RemoveSchema,
)<string>(async (input, ctx) => {
  const slot = findLocalSlot(await ctx.localSlots.read(), input.id);
  if (slot === undefined) {
    throw new Refused(`no local cell slot: ${input.id}`);
  }
  if (livePidOf(ctx, slot) !== null) {
    throw new Refused(`cell ${slot.name} is still running, stop it first`);
  }
  await ctx.localSlots.remove(slot.slotId);
  return slot.slotId;
});
