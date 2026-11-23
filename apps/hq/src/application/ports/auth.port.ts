import type { FactoryId, TokenId } from '../../domain/common/brand';

export const TOKEN_SCOPES = [
  'supervisor:read',
  'supervisor:write',
  'admin:tokens',
  'factory:enroll',
  'factory:worker',
] as const;

export type TokenScope = (typeof TOKEN_SCOPES)[number];

export type Principal = {
  tokenId: TokenId;
  factoryId: FactoryId | null;
  scopes: readonly TokenScope[];
};

export type AuthPort = {
  verify(bearer: string): Promise<Principal | null>;
};
