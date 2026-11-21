import { z } from 'zod';
import { revokeCellContract } from '../../../contracts/cells.contract';
import { ArgumentError } from '../../core/errors';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const RevokeSchema = z
  .object({
    id: z.string().trim().min(1),
    yes: z.boolean(),
  })
  .strict();

export interface RevokeResult {
  cellId: string;
}

export const revokeCell = define({ kind: 'supervisor' })(
  RevokeSchema,
)<RevokeResult>(async (input, ctx) => {
  if (!input.yes) {
    throw new ArgumentError(
      `revoke would revoke cell ${input.id}. Re-run with --yes`,
    );
  }
  const secret = await readSecret(ctx);
  revokeCellContract.out[200].parse(
    await ctx.server.remove(
      `/api/v1/cells/${encodeURIComponent(input.id)}`,
      secret,
    ),
  );
  return { cellId: input.id };
});
