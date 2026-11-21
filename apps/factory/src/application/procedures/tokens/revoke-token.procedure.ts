import { eq } from 'drizzle-orm';
import { immediateTx } from '../../../db/client';
import { safeTokens } from '../../../db/schema/tokens';
import { revokeTokenContract } from '../../../contracts/tokens.contract';
import { asTokenId } from '../../../domain/common/brand';
import { NotFound } from '../../core/error-handling';
import { scopedProcedure } from '../../core/procedure';
import { findSafeToken } from '../../tokens/token-writes';

export const revokeTokenProcedure = scopedProcedure(['admin:tokens'])(
  revokeTokenContract,
)((input, ctx) => {
  const tokenId = asTokenId(input.params.id);
  const now = ctx.clock.now();

  immediateTx(ctx.db, (tx) => {
    const row = findSafeToken(tx, tokenId);
    if (row === undefined) throw new NotFound(`Token ${tokenId} not found`);
    if (row.revokedAt !== null) return;
    tx.update(safeTokens)
      .set({ revokedAt: now })
      .where(eq(safeTokens.tokenId, tokenId))
      .run();
  });

  return { code: 200 as const };
});
