import type { Database } from 'bun:sqlite';
import type {
  JoinTokenRecord,
  JoinTokenStore,
} from '@repo/factory-core/ports/join-tokens';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

interface JoinTokenRow {
  join_token_id: string;
  name: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
}

const recordOf = (row: JoinTokenRow): JoinTokenRecord => ({
  joinTokenId: row.join_token_id,
  name: row.name,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
});

/** The `join_tokens` table behind `JoinTokenStore`: hashes only, never the plain token. */
export const sqliteJoinTokenStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): JoinTokenStore => ({
  create: ({ joinTokenId, tokenHash, name, createdAt, expiresAt, commandId }) =>
    gate.run(() => {
      writer.assertHeld();
      db.run(
        `INSERT INTO join_tokens (join_token_id, token_hash, name, created_at, expires_at, command_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [joinTokenId, tokenHash, name, createdAt, expiresAt, commandId],
      );
    }),
  createdForCommand: (commandId) =>
    gate.run(
      () =>
        db
          .query<{ found: number }, [string]>(
            'SELECT 1 AS found FROM join_tokens WHERE command_id = ? LIMIT 1',
          )
          .get(commandId) !== null,
    ),
  list: () =>
    gate.run(() =>
      db
        .query<JoinTokenRow, []>(
          'SELECT * FROM join_tokens ORDER BY created_at, join_token_id',
        )
        .all()
        .map(recordOf),
    ),
  revoke: (joinTokenId, at) =>
    gate.run(() => {
      writer.assertHeld();
      const result = db.run(
        'UPDATE join_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE join_token_id = ?',
        [at, joinTokenId],
      );
      return result.changes > 0;
    }),
  findActive: (tokenHash, at) =>
    gate.run(() => {
      const row = db
        .query<{ join_token_id: string; token_hash: string }, [string, number]>(
          `SELECT join_token_id, token_hash FROM join_tokens
           WHERE token_hash = ? AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > ?)`,
        )
        .get(tokenHash, at);
      return row
        ? { tokenHash: row.token_hash, joinTokenId: row.join_token_id }
        : undefined;
    }),
});
