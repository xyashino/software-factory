import { eq } from 'drizzle-orm';
import type { DbTx } from '../../../db/client';
import { stateTransitions } from '../../../db/schema/transitions';
import { asCommandId } from '../../../domain/common/brand';
import { Conflict } from '../../core/error-handling';

export const isCommandReplay = (
  tx: DbTx,
  entityId: string,
  commandId: string | undefined,
): boolean => {
  if (commandId === undefined) return false;
  const prior = tx
    .select()
    .from(stateTransitions)
    .where(eq(stateTransitions.commandId, asCommandId(commandId)))
    .get();
  if (prior === undefined) return false;
  if (prior.entityId !== entityId)
    throw new Conflict(`commandId ${commandId} belongs to another transition`);
  return true;
};
