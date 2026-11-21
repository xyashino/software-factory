import { asc, eq, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../../db/client';
import { cells } from '../../../db/schema/cells';
import { factories } from '../../../db/schema/factories';
import { settings } from '../../../db/schema/settings';
import { InternalServer, NotFound, Conflict } from '../../core/error-handling';
import type { SlotLaunch } from '../../ports/supervisor.port';
import { resolveSettings } from '../settings/resolve-settings';
import type { SlotId } from '../../../domain/common/brand';
import type { Settings } from '../../../domain/settings/preferences';

export type CellRecord = {
  slot: typeof cells.$inferSelect;
  factory: typeof factories.$inferSelect;
};

export const listRecords = (db: Db, condition?: SQL): CellRecord[] =>
  db
    .select({ slot: cells, factory: factories })
    .from(cells)
    .innerJoin(factories, eq(cells.factoryId, factories.factoryId))
    .where(condition)
    .orderBy(asc(cells.createdAt), asc(cells.name))
    .all();

export const findRecord = (db: Db, ref: string): CellRecord => {
  const matches = listRecords(
    db,
    or(
      eq(cells.slotId, ref as SlotId),
      eq(cells.cellId, ref),
      eq(cells.name, ref),
    ),
  );
  const exact = matches.find((record) => record.slot.slotId === ref);
  if (exact !== undefined) return exact;
  const [only] = matches;
  if (only === undefined) throw new NotFound(`cell not found: ${ref}`);
  if (matches.length > 1)
    throw new Conflict(`cell reference is ambiguous: ${ref}`);
  return only;
};

export const readSettings = (db: Db): Settings =>
  resolveSettings(db.select().from(settings).all());

export const toCellDto = ({ slot, factory }: CellRecord) => ({
  slotId: slot.slotId,
  name: slot.name,
  projectId: slot.projectId,
  cellId: slot.cellId,
  factoryName: factory.name,
  repoRoot: slot.repoRoot,
  desiredState: slot.desiredState,
  runtimeStatus: slot.runtimeStatus,
  pid: slot.pid,
  logPath: slot.logPath,
  lastError: slot.lastError,
});

export const launchOf = (
  { slot, factory }: CellRecord,
  herdrEnabled: boolean,
): SlotLaunch => {
  if (slot.sessionToken === null || slot.logPath === null)
    throw new InternalServer(`cell ${slot.name} has no session or log path`);
  return {
    slotId: slot.slotId,
    name: slot.name,
    factoryUrl: factory.url,
    sessionToken: slot.sessionToken,
    repoRoot: slot.repoRoot,
    logPath: slot.logPath,
    herdrEnabled,
  };
};
