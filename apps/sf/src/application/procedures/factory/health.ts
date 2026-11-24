import { HealthReplySchema } from '@repo/factory-contracts/status.contract';
import type { Ports } from '../../core/procedure';

export const healthPidOf = async (
  ctx: Pick<Ports, 'factory'>,
): Promise<number | null> => {
  try {
    return HealthReplySchema.parse(await ctx.factory.get('/health')).pid;
  } catch {
    return null;
  }
};
