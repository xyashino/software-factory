import { eq } from 'drizzle-orm';
import { LEASE_TTL_MS } from '../../config';
import type { DbTx } from '../../db/client';
import { factories } from '../../db/schema/factories';
import type { CellId, FactoryId } from '../../domain/common/brand';
import { Forbidden } from './error-handling';
import type { AuthenticatedContext } from './procedure';

export const isSilent = (lastSeenAt: number, now: number): boolean =>
  lastSeenAt + LEASE_TTL_MS <= now;

export const factoryIdOf = (ctx: AuthenticatedContext): FactoryId => {
  const factoryId = ctx.principal.factoryId;
  if (factoryId === null)
    throw new Forbidden('Token is not bound to a factory');
  return factoryId;
};

export const cellIdOf = (ctx: AuthenticatedContext): CellId => {
  if (ctx.cellId === null) throw new Forbidden('x-cell-id header is required');
  return ctx.cellId;
};

export const touchFactory = (
  tx: DbTx,
  factoryId: FactoryId,
  now: number,
): void => {
  tx.update(factories)
    .set({ lastSeenAt: now })
    .where(eq(factories.factoryId, factoryId))
    .run();
};
