import { eq } from 'drizzle-orm';
import { immediateTx } from '../../../db/client';
import { safeTokens } from '../../../db/schema/tokens';
import { rotateTokenContract } from '@repo/hq-contracts/tokens.contract';
import { TOKEN_ROTATE_GRACE_MS } from '../../../config';
import { Conflict, Unauthorized } from '../../core/error-handling';
import { authenticatedProcedure } from '../../core/procedure';
import { findSafeToken, insertSafeToken } from '../../tokens/token-writes';

export const rotateTokenProcedure = authenticatedProcedure(rotateTokenContract)(
  (_input, ctx) => {
    const current = ctx.principal.tokenId;
    const now = ctx.clock.now();

    return immediateTx(ctx.db, (tx) => {
      const row = findSafeToken(tx, current);
      if (row === undefined) throw new Unauthorized('Token no longer exists');
      const successor = tx
        .select()
        .from(safeTokens)
        .where(eq(safeTokens.rotatedFromId, current))
        .get();
      if (successor !== undefined)
        throw new Conflict(`Token ${current} was already rotated`);

      const issued = insertSafeToken(tx, {
        kind: row.kind,
        name: row.name,
        scopes: row.scopesJson,
        factoryId: row.factoryId,
        rotatedFromId: current,
        expiresAt: row.expiresAt,
        now,
      });
      const graceEnd = now + TOKEN_ROTATE_GRACE_MS;
      tx.update(safeTokens)
        .set({
          expiresAt:
            row.expiresAt === null
              ? graceEnd
              : Math.min(row.expiresAt, graceEnd),
        })
        .where(eq(safeTokens.tokenId, current))
        .run();

      return {
        code: 200 as const,
        tokenId: issued.tokenId,
        kind: row.kind,
        token: issued.token,
        scopes: row.scopesJson,
        expiresAt: row.expiresAt,
      };
    });
  },
);
