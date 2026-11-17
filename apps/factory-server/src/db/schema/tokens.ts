import {
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import type { CellId, TokenId } from '../../domain/common/brand';
import { jsonColumn } from '../columns';
import { cells } from './cells';

export const TOKEN_KINDS = ['supervisor', 'cell_join', 'cell_session'] as const;

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
  rotatedFromId: text('rotated_from_id')
    .$type<TokenId>()
    .references((): AnySQLiteColumn => safeTokens.tokenId),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
  lastUsedAt: integer('last_used_at'),
  createdAt: integer('created_at').notNull(),
});
