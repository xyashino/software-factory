import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type { CellId, FactoryId, TokenId } from '../../domain/common/brand';
import { jsonColumn } from '@repo/bun-sqlite-kit/columns';
import { cells } from './cells';
import { factories } from './factories';

export const TOKEN_KINDS = [
  'supervisor',
  'cell_join',
  'cell_session',
  'web_join',
  'web_session',
  'factory_join',
  'factory_session',
] as const;

export const safeTokens = sqliteTable('safe_tokens', {
  tokenId: text('token_id').$type<TokenId>().primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  kind: text('kind', { enum: TOKEN_KINDS }).notNull(),
  name: text('name').notNull(),
  scopesJson: jsonColumn<string[]>('scopes_json').notNull(),
  cellId: text('cell_id')
    .$type<CellId>()
    .references(() => cells.cellId),
  factoryId: text('factory_id')
    .$type<FactoryId>()
    .references(() => factories.factoryId),
  rotatedFromId: text('rotated_from_id')
    .$type<TokenId>()
    .references((): AnySQLiteColumn => safeTokens.tokenId),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
  lastUsedAt: integer('last_used_at'),
  createdAt: integer('created_at').notNull(),
});
