import { issueTokenContract } from '@repo/hq-contracts/tokens.contract';
import { titleSchema } from '@repo/zod-contract-kit/fields';
import { z } from 'zod';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const TOKENS_ROUTE = '/api/v1/tokens';

const TokenCreateSchema = z
  .object({
    kind: z.enum(['factory_join', 'operator']),
    name: titleSchema,
  })
  .strict();

export interface TokenCreateResult {
  tokenId: string;
  kind: 'operator' | 'factory_join' | 'factory_session';
  token: string;
  scopes: string[];
  expiresAt: number | null;
}

export const createToken = define({ kind: 'operator' })(
  TokenCreateSchema,
)<TokenCreateResult>(async (input, ctx) => {
  const secret = await readSecret(ctx);
  const reply = issueTokenContract.out[201].parse(
    await ctx.hq.call(TOKENS_ROUTE, { ...input, expiresAt: null }, secret),
  );
  return {
    tokenId: reply.tokenId,
    kind: reply.kind,
    token: reply.token,
    scopes: reply.scopes,
    expiresAt: reply.expiresAt,
  };
});
