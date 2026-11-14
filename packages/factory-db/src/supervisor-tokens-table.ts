import type { Database } from 'bun:sqlite';
import type { SupervisorTokenStore } from '@repo/factory-core/ports/supervisor-tokens';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

/** The `supervisor_tokens` table behind `SupervisorTokenStore`: hashes only, never the plain token. */
export const sqliteSupervisorTokenStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): SupervisorTokenStore => ({
  create: ({ tokenHash, name, createdAt }) =>
    gate.run(() => {
      writer.assertHeld();
      db.run(
        'INSERT INTO supervisor_tokens (token_hash, name, created_at) VALUES (?, ?, ?)',
        [tokenHash, name, createdAt],
      );
    }),
  find: (tokenHash) =>
    gate.run(() => {
      const row = db
        .query<{ token_hash: string; name: string }, [string]>(
          'SELECT token_hash, name FROM supervisor_tokens WHERE token_hash = ?',
        )
        .get(tokenHash);
      return row ? { tokenHash: row.token_hash, name: row.name } : undefined;
    }),
});
