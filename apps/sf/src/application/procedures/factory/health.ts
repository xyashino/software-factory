import { z } from 'zod';
import type { Ports } from '../../core/procedure';

const HealthSchema = z.object({ pid: z.number().int().positive() });

export const healthPidOf = async (
  ctx: Pick<Ports, 'factory'>,
): Promise<number | null> => {
  try {
    return HealthSchema.parse(await ctx.factory.get('/health')).pid;
  } catch {
    return null;
  }
};
