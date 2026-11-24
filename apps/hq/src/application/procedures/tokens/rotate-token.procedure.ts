import { rotateTokenContract } from '@repo/hq-contracts/tokens.contract';
import { TOKEN_ROTATE_GRACE_MS } from '../../../config';
import { Conflict, Unauthorized } from '../../core/error-handling';
import { authenticatedProcedure } from '../../core/procedure';
import { insertSafeToken } from '../../tokens/token-writes';

export const rotateTokenProcedure = authenticatedProcedure(rotateTokenContract)(
  (_input, ctx) => {
    const current = ctx.principal.tokenId;
    const now = ctx.clock.now();

    return ctx.storage.write((tx) => {
      const row = tx.tokens.find(current);
      if (row === undefined) throw new Unauthorized('Token no longer exists');
      if (tx.tokens.findSuccessor(current) !== undefined)
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
      tx.tokens.update(current, {
        expiresAt:
          row.expiresAt === null ? graceEnd : Math.min(row.expiresAt, graceEnd),
      });

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
