import { revokeTokenContract } from '@repo/hq-contracts/tokens.contract';
import { asTokenId } from '../../../domain/common/brand';
import { NotFound } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';

export const revokeTokenProcedure = scopedProcedure(['admin:tokens'])(
  revokeTokenContract,
)(async (input, ctx) => {
  const tokenId = asTokenId(input.params.id);
  const now = ctx.clock.now();

  await ctx.storage.write((tx) => {
    const row = tx.tokens.find(tokenId);
    if (row === undefined) throw new NotFound(`Token ${tokenId} not found`);
    if (row.revokedAt !== null) return;
    tx.tokens.update(tokenId, { revokedAt: now });
  });

  return { code: 200 as const };
});
