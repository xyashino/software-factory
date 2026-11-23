import { z } from 'zod';
import type { Ports } from '../../core/procedure';

const HealthSchema = z.object({ pid: z.number().int().positive() });

export const healthPidOf = async (
  ctx: Pick<Ports, 'factoryDaemon'>,
): Promise<number | null> => {
  try {
    return HealthSchema.parse(await ctx.factoryDaemon.get('/health')).pid;
  } catch {
    return null;
  }
};
