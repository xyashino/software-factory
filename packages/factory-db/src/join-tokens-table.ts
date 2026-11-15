import type { Database } from 'bun:sqlite';
import type {
  JoinTokenRecord,
  JoinTokenStore,
} from '@repo/factory-core/ports/join-tokens';
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { drizzleOf, type FactoryDatabase } from './db';
import { joinTokens } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

type JoinTokenRow = typeof joinTokens.$inferSelect;

const recordOf = (row: JoinTokenRow): JoinTokenRecord => ({
  joinTokenId: row.joinTokenId,
  name: row.name,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
});

const selectJoinTokens = (orm: FactoryDatabase) =>
  orm.select().from(joinTokens);

/** The `join_tokens` table behind `JoinTokenStore`: hashes only, never the plain token. */
export const sqliteJoinTokenStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): JoinTokenStore => {
  const orm = drizzleOf(db);
  return {
    create: ({
      joinTokenId,
      tokenHash,
      name,
      createdAt,
      expiresAt,
      commandId,
    }) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .insert(joinTokens)
          .values({
            joinTokenId,
            tokenHash,
            name,
            createdAt,
            expiresAt,
            commandId,
          })
          .run();
      }),
    createdForCommand: (commandId) =>
      gate.run(
        () =>
          orm
            .select({ joinTokenId: joinTokens.joinTokenId })
            .from(joinTokens)
            .where(eq(joinTokens.commandId, commandId))
            .limit(1)
            .get() !== undefined,
      ),
    list: () =>
      gate.run(() =>
        selectJoinTokens(orm)
          .orderBy(asc(joinTokens.createdAt), asc(joinTokens.joinTokenId))
          .all()
          .map(recordOf),
      ),
    revoke: (joinTokenId, at) =>
      gate.run(() => {
        writer.assertHeld();
        // `returning` gives the rows the UPDATE touched, which is what `changes > 0` used to report.
        const touched = orm
          .update(joinTokens)
          .set({
            revokedAt: sql`coalesce(${joinTokens.revokedAt}, ${at})`,
          })
          .where(eq(joinTokens.joinTokenId, joinTokenId))
          .returning({ joinTokenId: joinTokens.joinTokenId })
          .all();
        return touched.length > 0;
      }),
    findActive: (tokenHash, at) =>
      gate.run(() => {
        const row = orm
          .select({
            joinTokenId: joinTokens.joinTokenId,
            tokenHash: joinTokens.tokenHash,
          })
          .from(joinTokens)
          .where(
            and(
              eq(joinTokens.tokenHash, tokenHash),
              isNull(joinTokens.revokedAt),
              or(isNull(joinTokens.expiresAt), gt(joinTokens.expiresAt, at)),
            ),
          )
          .get();
        return row
          ? { tokenHash: row.tokenHash, joinTokenId: row.joinTokenId }
          : undefined;
      }),
  };
};
