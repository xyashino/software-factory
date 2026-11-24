import type { AuthPort } from '../application/ports/auth.port';
import type { ClaimWaitersPort } from '../application/ports/claim-waiters.port';
import type { ClockPort } from '../application/ports/clock.port';
import type { StoragePort } from '../application/ports/storage.port';
import type { TransitionBusPort } from '../application/ports/transition-bus.port';
import type { CreateTransport } from '../adapters/hono/types';

export type TransportDeps = {
  storage: StoragePort;
  clock: ClockPort;
  auth: AuthPort;
  claimWaiters: ClaimWaitersPort;
  transitionBus: TransitionBusPort;
};

export const createTransport =
  (deps: TransportDeps): CreateTransport =>
  (request) => ({
    ...deps,
    bearer: request.bearer,
    cellId: request.cellId,
    signal: request.signal,
    remoteAddress: request.remoteAddress,
  });
