import { eq } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client';
import type { TOKEN_KINDS } from '../../db/schema/tokens';
import { safeTokens } from '../../db/schema/tokens';
import type { FactoryId, TokenId } from '../../domain/common/brand';
import { asTokenId } from '../../domain/common/brand';
import type { TokenScope } from '../ports/auth.port';
import {
  hashToken,
  mintToken,
  TOKEN_PREFIXES,
  type TokenPrefix,
} from './token-hash';

export const DEFAULT_SCOPES: Record<'operator' | 'factory_join', TokenScope[]> =
  {
    operator: ['operator:read', 'operator:write', 'admin:tokens'],
    factory_join: ['factory:enroll'],
  };

const PREFIX_BY_KIND: Record<TokenKind, TokenPrefix> = {
  operator: TOKEN_PREFIXES.operator,
  web_join: TOKEN_PREFIXES.join,
  web_session: TOKEN_PREFIXES.operator,
  factory_join: TOKEN_PREFIXES.join,
  factory_session: TOKEN_PREFIXES.factory,
};

type TokenKind = (typeof TOKEN_KINDS)[number];
type Queryable = Db | DbTx;

export type SafeTokenRow = typeof safeTokens.$inferSelect;

export type NewSafeToken = {
  kind: TokenKind;
  name: string;
  scopes: readonly string[];
  factoryId?: FactoryId | null;
  rotatedFromId: TokenId | null;
  expiresAt: number | null;
  now: number;
};

export type IssuedSafeToken = { tokenId: TokenId; token: string };

export const findSafeToken = (
  db: Queryable,
  tokenId: TokenId,
): SafeTokenRow | undefined =>
  db.select().from(safeTokens).where(eq(safeTokens.tokenId, tokenId)).get();

export const insertSafeToken = (
  tx: DbTx,
  input: NewSafeToken,
): IssuedSafeToken => {
  const token = mintToken(PREFIX_BY_KIND[input.kind]);
  const tokenId = asTokenId(crypto.randomUUID());
  tx.insert(safeTokens)
    .values({
      tokenId,
      tokenHash: hashToken(token),
      prefix: PREFIX_BY_KIND[input.kind],
      kind: input.kind,
      name: input.name,
      scopesJson: [...input.scopes],
      factoryId: input.factoryId ?? null,
      rotatedFromId: input.rotatedFromId,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    })
    .run();
  return { tokenId, token };
};
