import { z } from 'zod';
import { drainCellContract } from '@repo/factory-contracts/cells.contract';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const StopSchema = z
  .object({
    id: z.string().trim().min(1),
    force: z.boolean(),
  })
  .strict();

export interface StopResult {
  cellId: string;
  status: 'draining';
  force: boolean;
}

export const stopCell = define({ kind: 'supervisor' })(StopSchema)<StopResult>(
  async (input, ctx) => {
    const secret = await readSecret(ctx);
    const reply = drainCellContract.out[200].parse(
      await ctx.server.call(
        `/api/v1/cells/${encodeURIComponent(input.id)}/drain`,
        { force: input.force },
        secret,
      ),
    );
    return { cellId: input.id, status: reply.status, force: reply.force };
  },
);
