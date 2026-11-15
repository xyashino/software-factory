import type { Database } from 'bun:sqlite';
import type { CellId } from '@repo/factory-core/ids';
import type {
  CellInfo,
  CellRecord,
  CellStore,
} from '@repo/factory-core/ports/cells';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzleOf, type FactoryDatabase } from './db';
import { cells } from './schema';
import type { StatementGate } from './sqlite-event-store';
import type { WriterLock } from './writer-lock';

type CellRow = typeof cells.$inferSelect;

const recordOf = (row: CellRow): CellRecord => ({
  cellId: row.cellId as CellId,
  name: row.name,
  info: row.info === null ? null : (JSON.parse(row.info) as CellInfo),
  joinedAt: row.joinedAt,
  lastSeenAt: row.lastSeenAt,
  revokedAt: row.revokedAt,
});

const selectCells = (orm: FactoryDatabase) => orm.select().from(cells);

/** The `cells` table behind `CellStore`. `token_hash` marks the local, operating-system trust. */
export const sqliteCellStore = (
  db: Database,
  writer: WriterLock,
  gate: StatementGate,
): CellStore => {
  const orm = drizzleOf(db);
  return {
    hello: ({ cellId, name, info, at }) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .insert(cells)
          .values({
            cellId,
            name,
            tokenHash: 'local:os-account',
            joinedAt: at,
            lastSeenAt: at,
            info: JSON.stringify(info),
          })
          .onConflictDoUpdate({
            target: cells.cellId,
            set: {
              name,
              lastSeenAt: at,
              info: JSON.stringify(info),
            },
          })
          .run();
      }),
    get: (cellId) =>
      gate.run(() => {
        const row = selectCells(orm).where(eq(cells.cellId, cellId)).get();
        return row ? recordOf(row) : undefined;
      }),
    list: () =>
      gate.run(() =>
        selectCells(orm)
          .orderBy(asc(cells.joinedAt), asc(cells.cellId))
          .all()
          .map(recordOf),
      ),
    touch: (cellId, at) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .update(cells)
          .set({ lastSeenAt: at })
          .where(eq(cells.cellId, cellId))
          .run();
      }),
    revoke: (cellId, at) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .update(cells)
          .set({ revokedAt: sql`coalesce(${cells.revokedAt}, ${at})` })
          .where(eq(cells.cellId, cellId))
          .run();
      }),
    join: ({ cellId, name, credentialHash, joinedWith, at }) =>
      gate.run(() => {
        writer.assertHeld();
        orm
          .insert(cells)
          .values({
            cellId,
            name,
            tokenHash: credentialHash,
            joinedWith,
            joinedAt: at,
          })
          .run();
      }),
    findByCredentialHash: (credentialHash) =>
      gate.run(() => {
        const row = selectCells(orm)
          .where(eq(cells.tokenHash, credentialHash))
          .limit(1)
          .get();
        return row
          ? { credentialHash: row.tokenHash, record: recordOf(row) }
          : undefined;
      }),
  };
};
