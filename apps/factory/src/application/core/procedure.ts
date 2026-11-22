import type { Db } from '../../db/client';
import type { AuthPort, Principal, TokenScope } from '../ports/auth.port';
import type { ClaimWaitersPort } from '../ports/claim-waiters.port';
import type { ClockPort } from '../ports/clock.port';
import type { TransitionBusPort } from '../ports/transition-bus.port';
import { Forbidden, Unauthorized } from './error-handling';
import type {
  ContractInput,
  ProcedureResponse,
  RawInput,
  ZodContract,
} from '@repo/zod-contract-kit/types';
import { withZodSchema } from './schema/zod';

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

export type Access =
  | { kind: 'public' }
  | { kind: 'all'; scopes: readonly TokenScope[] }
  | { kind: 'any'; scopes: readonly TokenScope[] };

export type ContextFor<A extends Access> = A extends { kind: 'public' }
  ? TransportContext
  : AuthenticatedContext;

export type Procedure = {
  readonly access: Access;
  readonly contract: ZodContract;
  execute(raw: RawInput, ctx: TransportContext): Promise<ProcedureResponse>;
};

const authenticate = async (ctx: TransportContext): Promise<Principal> => {
  const principal =
    ctx.bearer === null ? null : await ctx.auth.verify(ctx.bearer);
  if (principal === null)
    throw new Unauthorized('Missing or invalid bearer token');
  return principal;
};

const checkAccess = async <A extends Access>(
  access: A,
  ctx: TransportContext,
): Promise<ContextFor<A>> => {
  if (access.kind === 'public') return ctx as ContextFor<A>;
  const principal = await authenticate(ctx);
  switch (access.kind) {
    case 'all': {
      const missing = access.scopes.filter(
        (scope) => !principal.scopes.includes(scope),
      );
      if (missing.length > 0)
        throw new Forbidden(`Token lacks scope: ${missing.join(', ')}`);
      break;
    }
    case 'any':
      if (!access.scopes.some((scope) => principal.scopes.includes(scope)))
        throw new Forbidden(`Token needs one of: ${access.scopes.join(', ')}`);
      break;
    default: {
      const exhausted: never = access;
      return exhausted;
    }
  }
  return { ...ctx, principal } as ContextFor<A>;
};

const define =
  <A extends Access>(access: A) =>
  <C extends ZodContract>(contract: C) =>
  <R extends ProcedureResponse>(
    handler: (input: ContractInput<C>, ctx: ContextFor<A>) => R | Promise<R>,
  ): Procedure => {
    const run = withZodSchema(contract)(handler);
    return {
      access,
      contract,
      execute: async (raw, ctx) => run(raw, await checkAccess(access, ctx)),
    };
  };

export const authorize = (
  ctx: TransportContext,
  requiredScopes: readonly TokenScope[],
): Promise<AuthenticatedContext> =>
  checkAccess({ kind: 'all', scopes: requiredScopes }, ctx);

export const publicProcedure = define({ kind: 'public' });

export const scopedProcedure = (requiredScopes: readonly TokenScope[]) =>
  define({ kind: 'all', scopes: requiredScopes });

export const anyScopedProcedure = (allowedScopes: readonly TokenScope[]) =>
  define({ kind: 'any', scopes: allowedScopes });

export const authenticatedProcedure = scopedProcedure([]);
