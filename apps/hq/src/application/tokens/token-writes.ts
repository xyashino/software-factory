import type { FactoryId, TokenId } from '../../domain/common/brand';
import { asTokenId } from '../../domain/common/brand';
import type { TokenKind } from '../../domain/common/vocabulary';
import type { TokenScope } from '../ports/auth.port';
import type { StorageWriteTx } from '../ports/storage.port';
import {
  hashToken,
  mintToken,
  TOKEN_PREFIXES,
  type TokenPrefix,
} from './token-hash';

export const DEFAULT_SCOPES: Record<
  'supervisor' | 'factory_join',
  TokenScope[]
> = {
  supervisor: ['supervisor:read', 'supervisor:write', 'admin:tokens'],
  factory_join: ['factory:enroll'],
};

const PREFIX_BY_KIND: Record<TokenKind, TokenPrefix> = {
  supervisor: TOKEN_PREFIXES.supervisor,
  web_join: TOKEN_PREFIXES.join,
  web_session: TOKEN_PREFIXES.supervisor,
  factory_join: TOKEN_PREFIXES.join,
  factory_session: TOKEN_PREFIXES.factory,
};

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

export const insertSafeToken = (
  tx: StorageWriteTx,
  input: NewSafeToken,
): IssuedSafeToken => {
  const token = mintToken(PREFIX_BY_KIND[input.kind]);
  const tokenId = asTokenId(crypto.randomUUID());
  tx.tokens.insert({
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
  });
  return { tokenId, token };
};
