import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_PREFIXES = {
  supervisor: 'sf_sup_',
  join: 'sf_join_',
  cell: 'sf_cell_',
} as const;

export type TokenPrefix = (typeof TOKEN_PREFIXES)[keyof typeof TOKEN_PREFIXES];

export const hashToken = (raw: string): string =>
  createHash('sha256').update(raw).digest('hex');

export const mintToken = (prefix: TokenPrefix): string =>
  `${prefix}${randomBytes(32).toString('base64url')}`;
