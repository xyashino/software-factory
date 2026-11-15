import type { Database } from 'bun:sqlite';
import type { SupervisorTokenStore } from '@repo/factory-core/ports/supervisor-tokens';
import { eq } from 'drizzle-orm';
import { drizzleOf } from './db';
import { supervisorTokens } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

/** The `supervisor_tokens` table behind `SupervisorTokenStore`: hashes only, never the plain token. */
export const sqliteSupervisorTokenStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): SupervisorTokenStore => {
  const orm = drizzleOf(db);
  return {
    create: ({ tokenHash, name, createdAt }) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .insert(supervisorTokens)
          .values({ tokenHash, name, createdAt })
          .run();
      }),
    find: (tokenHash) =>
      gate.run(() => {
        const row = orm
          .select({
            tokenHash: supervisorTokens.tokenHash,
            name: supervisorTokens.name,
          })
          .from(supervisorTokens)
          .where(eq(supervisorTokens.tokenHash, tokenHash))
          .get();
        return row ? { tokenHash: row.tokenHash, name: row.name } : undefined;
      }),
  };
};
