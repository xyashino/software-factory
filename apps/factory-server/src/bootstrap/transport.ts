import type { Db } from '../db/client';
import type { AuthPort } from '../application/ports/auth.port';
import type { ClaimWaitersPort } from '../application/ports/claim-waiters.port';
import type { ClockPort } from '../application/ports/clock.port';
import type { TransitionBusPort } from '../application/ports/transition-bus.port';
import type { CreateTransport } from '../adapters/hono/types';

export type TransportDeps = {
  db: Db;
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
    signal: request.signal,
  });
