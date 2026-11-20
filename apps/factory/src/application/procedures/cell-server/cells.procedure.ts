import { z } from 'zod';
import { define } from '../../core/procedure';
import { type Cell, CellReplySchema, CellsReplySchema } from './shapes';

const CreateSchema = z
  .object({
    repoRoot: z.string().min(1),
    factory: z.string().min(1).optional(),
    count: z.number().int().min(1).optional(),
    name: z.string().min(1).optional(),
    allowedLines: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

const SlotSchema = z.object({ slotId: z.string().min(1) }).strict();
const ForceSchema = z.object({ force: z.boolean().default(false) }).strict();
const StopSchema = SlotSchema.merge(ForceSchema);
const EmptySchema = z.object({}).strict();

const slotRoute = (slotId: string): string =>
  `/api/v1/cells/${encodeURIComponent(slotId)}`;

export const createCells = define({ kind: 'supervisor' })(CreateSchema)<Cell[]>(
  async (input, ctx) => {
    const reply = await ctx.cellServer.post('/api/v1/cells', input);
    return CellsReplySchema.parse(reply).cells;
  },
);

export const listCells = define({ kind: 'supervisor' })(EmptySchema)<Cell[]>(
  async (_input, ctx) => {
    const reply = await ctx.cellServer.get('/api/v1/cells');
    return CellsReplySchema.parse(reply).cells;
  },
);

export const stopCell = define({ kind: 'supervisor' })(StopSchema)<Cell>(
  async (input, ctx) => {
    const reply = await ctx.cellServer.post(`${slotRoute(input.slotId)}/stop`, {
      force: input.force,
    });
    return CellReplySchema.parse(reply).cell;
  },
);

export const stopAllCells = define({ kind: 'supervisor' })(ForceSchema)<Cell[]>(
  async (input, ctx) => {
    const reply = await ctx.cellServer.post('/api/v1/cells/stop-all', {
      force: input.force,
    });
    return CellsReplySchema.parse(reply).cells;
  },
);

export const removeCell = define({ kind: 'supervisor' })(SlotSchema)<string>(
  async (input, ctx) => {
    await ctx.cellServer.delete(slotRoute(input.slotId));
    return input.slotId;
  },
);
