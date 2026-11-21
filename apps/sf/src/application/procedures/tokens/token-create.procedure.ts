import { z } from 'zod';
import { issueTokenContract } from '../../../contracts/tokens.contract';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const TOKENS_ROUTE = '/api/v1/tokens';

const TokenCreateSchema = z
  .object({
    kind: z.enum(['cell_join', 'supervisor']),
    name: z.string().trim().min(1),
  })
  .strict();

export interface TokenCreateResult {
  tokenId: string;
  kind: 'supervisor' | 'cell_join' | 'cell_session';
  token: string;
  scopes: string[];
  expiresAt: number | null;
}

export const createToken = define({ kind: 'supervisor' })(
  TokenCreateSchema,
)<TokenCreateResult>(async (input, ctx) => {
  const secret = await readSecret(ctx);
  const reply = issueTokenContract.out[201].parse(
    await ctx.server.call(TOKENS_ROUTE, { ...input, expiresAt: null }, secret),
  );
  return {
    tokenId: reply.tokenId,
    kind: reply.kind,
    token: reply.token,
    scopes: reply.scopes,
    expiresAt: reply.expiresAt,
  };
});
