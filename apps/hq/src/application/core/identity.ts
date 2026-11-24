import { LEASE_TTL_MS } from '../../config';
import type { CellId, FactoryId } from '../../domain/common/brand';
import type { StorageWriteTx } from '../ports/storage.port';
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
  tx: StorageWriteTx,
  factoryId: FactoryId,
  now: number,
): void => {
  tx.factories.update(factoryId, { lastSeenAt: now });
};
