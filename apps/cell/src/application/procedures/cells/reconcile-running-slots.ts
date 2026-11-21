import { eq } from 'drizzle-orm';
import { cells } from '../../../db/schema/cells';
import type { SlotRuntimeDeps } from './slot-runtime';
import { startSlot } from './slot-runtime';
import { listRecords } from './cell-views';

export const reconcileRunningSlots = async (
  deps: SlotRuntimeDeps,
): Promise<void> => {
  for (const record of listRecords(deps.db, eq(cells.desiredState, 'running')))
    await startSlot(deps, record);
};
