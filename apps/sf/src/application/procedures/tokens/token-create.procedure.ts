import { issueTokenContract } from '@repo/factory-contracts/tokens.contract';
import { titleSchema } from '@repo/zod-contract-kit/fields';
import { z } from 'zod';
import { define } from '../../core/procedure';
import { readSecret } from '../../core/repo-access';

const TOKENS_ROUTE = '/api/v1/tokens';

const TokenCreateSchema = z
  .object({
    kind: z.enum(['cell_join', 'factory_join', 'supervisor']),
    name: titleSchema,
  })
  .strict();

export interface TokenCreateResult {
  tokenId: string;
  kind:
    | 'supervisor'
    | 'cell_join'
    | 'cell_session'
    | 'factory_join'
    | 'factory_session';
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
