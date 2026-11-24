import { bigint, type AnyPgColumn, pgTable, text } from 'drizzle-orm/pg-core';
import type { FactoryId, TokenId } from '../../../domain/common/brand';
import { TOKEN_KINDS } from '../../../domain/common/vocabulary';
import { epochMs, jsonColumn } from './columns';
import { factories } from './factories';

export const safeTokens = pgTable('safe_tokens', {
  tokenId: text('token_id').$type<TokenId>().primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  kind: text('kind', { enum: TOKEN_KINDS }).notNull(),
  name: text('name').notNull(),
  scopesJson: jsonColumn<string[]>('scopes_json').notNull(),
  factoryId: text('factory_id')
    .$type<FactoryId>()
    .references(() => factories.factoryId),
  rotatedFromId: text('rotated_from_id')
    .$type<TokenId>()
    .references((): AnyPgColumn => safeTokens.tokenId),
  expiresAt: bigint('expires_at', { mode: 'number' }),
  revokedAt: bigint('revoked_at', { mode: 'number' }),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }),
  createdAt: epochMs('created_at').notNull(),
});
