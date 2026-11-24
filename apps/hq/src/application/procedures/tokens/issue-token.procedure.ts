import { issueTokenContract } from '@repo/hq-contracts/tokens.contract';
import { scopedProcedure } from '../../core/procedure';
import { DEFAULT_SCOPES, insertSafeToken } from '../../tokens/token-writes';

export const issueTokenProcedure = scopedProcedure(['admin:tokens'])(
  issueTokenContract,
)(async (input, ctx) => {
  const { kind, name, expiresAt } = input.body;
  const scopes = DEFAULT_SCOPES[kind];
  const issued = await ctx.storage.write((tx) =>
    insertSafeToken(tx, {
      kind,
      name,
      scopes,
      rotatedFromId: null,
      expiresAt,
      now: ctx.clock.now(),
    }),
  );
  return {
    code: 201 as const,
    tokenId: issued.tokenId,
    kind,
    token: issued.token,
    scopes,
    expiresAt,
  };
});
