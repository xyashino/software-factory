import { z } from 'zod';
import type { LocalSlot } from '../../../domain/cell/local-slot';
import { findLocalSlot } from '../../../domain/cell/local-slot';
import { Refused } from '../../core/errors';
import { type Context, define, type Ports } from '../../core/procedure';
import type { Access } from '../../../domain/access';
import { listCells } from './list.procedure';
import { livePidOf } from './local-pid';
import { stopCell } from './stop.procedure';

const STOP_WAIT_MS = 10_000;
const STOP_POLL_MS = 100;

const StopSchema = z
  .object({
    id: z.string().trim().min(1),
    force: z.boolean(),
  })
  .strict();

const StopAllSchema = z.object({ force: z.boolean() }).strict();

const exitedWithin = async (
  ports: Ports,
  pid: number,
  timeoutMs: number,
): Promise<boolean> => {
  for (let waited = 0; waited < timeoutMs; waited += STOP_POLL_MS) {
    if (!ports.process.isAlive(pid)) {
      return true;
    }
    await ports.clock.sleep(STOP_POLL_MS);
  }
  return !ports.process.isAlive(pid);
};

const handOverOf = async (
  ctx: Context<Access>,
  slot: LocalSlot,
): Promise<void> => {
  const { rows } = await listCells.execute({}, ctx);
  const row = rows.find((candidate) => candidate.name === slot.name);
  if (row === undefined) {
    return;
  }
  await stopCell.execute({ id: row.cellId, force: true }, ctx);
};

const stopSlot = async (
  ctx: Context<Access>,
  slot: LocalSlot,
  force: boolean,
): Promise<LocalSlot> => {
  const pid = livePidOf(ctx, slot);
  if (pid === null) {
    return { ...slot, pid: null, state: 'stopped' };
  }
  if (force) {
    await handOverOf(ctx, slot);
  }
  ctx.process.terminate(pid);
  if (!(await exitedWithin(ctx, pid, STOP_WAIT_MS))) {
    throw new Refused(`cell ${slot.name} did not exit after SIGTERM`);
  }
  return { ...slot, pid: null, state: 'stopped' };
};

export const stopLocalCell = define({ kind: 'supervisor' })(
  StopSchema,
)<LocalSlot | null>(async (input, ctx) => {
  const slots = await ctx.localSlots.read();
  const slot = findLocalSlot(slots, input.id);
  if (slot === undefined) {
    return null;
  }
  const stopped = await stopSlot(ctx, slot, input.force);
  await ctx.localSlots.write(
    slots.map((candidate) =>
      candidate.slotId === stopped.slotId ? stopped : candidate,
    ),
  );
  return stopped;
});

export const stopAllLocalCells = define({ kind: 'supervisor' })(StopAllSchema)<
  LocalSlot[]
>(async (input, ctx) => {
  const slots = await ctx.localSlots.read();
  const updated: LocalSlot[] = [];
  for (const slot of slots) {
    updated.push(
      slot.state === 'running' ? await stopSlot(ctx, slot, input.force) : slot,
    );
  }
  await ctx.localSlots.write(updated);
  return updated;
});
