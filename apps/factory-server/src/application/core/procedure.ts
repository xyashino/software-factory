import type { Db } from '../../db/client';
import type { AuthPort, Principal, TokenScope } from '../ports/auth.port';
import type { ClaimWaitersPort } from '../ports/claim-waiters.port';
import type { ClockPort } from '../ports/clock.port';
import type { TransitionBusPort } from '../ports/transition-bus.port';
import { Forbidden, Unauthorized } from './error-handling';
import { withZodSchema } from './schema/zod';
import type {
  ContractInput,
  ProcedureResponse,
  RawInput,
  ZodContract,
} from './schema/types';

export type TransportContext = {
  db: Db;
  clock: ClockPort;
  auth: AuthPort;
  claimWaiters: ClaimWaitersPort;
  transitionBus: TransitionBusPort;
  bearer: string | null;
  signal: AbortSignal;
  remoteAddress: string | null;
};

export type AuthenticatedContext = TransportContext & { principal: Principal };

export type Procedure = (
  raw: RawInput,
  ctx: TransportContext,
) => Promise<ProcedureResponse>;

const authenticate = async (ctx: TransportContext): Promise<Principal> => {
  const principal =
    ctx.bearer === null ? null : await ctx.auth.verify(ctx.bearer);
  if (principal === null)
    throw new Unauthorized('Missing or invalid bearer token');
  return principal;
};

export const authorize = async (
  ctx: TransportContext,
  requiredScopes: readonly TokenScope[],
): Promise<AuthenticatedContext> => {
  const principal = await authenticate(ctx);
  const missing = requiredScopes.filter(
    (scope) => !principal.scopes.includes(scope),
  );
  if (missing.length > 0)
    throw new Forbidden(`Token lacks scope: ${missing.join(', ')}`);
  return { ...ctx, principal };
};

export const publicProcedure =
  <C extends ZodContract>(contract: C) =>
  <R extends ProcedureResponse>(
    handler: (input: ContractInput<C>, ctx: TransportContext) => R | Promise<R>,
  ): Procedure =>
    withZodSchema(contract)(handler);

export const scopedProcedure =
  (requiredScopes: readonly TokenScope[]) =>
  <C extends ZodContract>(contract: C) =>
  <R extends ProcedureResponse>(
    handler: (
      input: ContractInput<C>,
      ctx: AuthenticatedContext,
    ) => R | Promise<R>,
  ): Procedure => {
    const run = withZodSchema(contract)(handler);
    return async (raw, ctx) => run(raw, await authorize(ctx, requiredScopes));
  };

export const anyScopedProcedure =
  (allowedScopes: readonly TokenScope[]) =>
  <C extends ZodContract>(contract: C) =>
  <R extends ProcedureResponse>(
    handler: (
      input: ContractInput<C>,
      ctx: AuthenticatedContext,
    ) => R | Promise<R>,
  ): Procedure => {
    const run = withZodSchema(contract)(handler);
    return async (raw, ctx) => {
      const principal = await authenticate(ctx);
      if (!allowedScopes.some((scope) => principal.scopes.includes(scope)))
        throw new Forbidden(`Token needs one of: ${allowedScopes.join(', ')}`);
      return run(raw, { ...ctx, principal });
    };
  };

export const authenticatedProcedure = <C extends ZodContract>(contract: C) =>
  scopedProcedure([])(contract);
