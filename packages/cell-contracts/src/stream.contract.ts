import { z } from 'zod';

export const CELL_EVENT_KINDS = [
  'cell.started',
  'cell.stopping',
  'cell.stopped',
  'cell.failed',
  'cell.removed',
] as const;

export const cellEventSchema = z.object({
  kind: z.enum(CELL_EVENT_KINDS),
  at: z.number().int(),
  slotId: z.string().optional(),
});

export type CellEvent = z.infer<typeof cellEventSchema>;
