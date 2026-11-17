import { createHash, timingSafeEqual } from 'node:crypto';
import type { HttpAuth } from '@repo/factory-core/contracts/http-routes';
import { RefusalError } from '../../application/core/error-handling';
import type { Caller } from '../../application/ports/auth.port';
import type { AuthPort } from '../../application/ports/auth.port';
import type { RuntimePort } from '../../application/ports/runtime.port';
import type { AuthCache } from './auth-cache';

/** The name a local client's supervisor token carries: the server's own, not a stored token's. */
export const LOCAL_SUPERVISOR_NAME = 'local';

/** Whether a route's credential classes (PROTOCOL §1) admit a caller of this kind. */
const admits = (auth: HttpAuth, caller: Caller): boolean => {
  if (caller.kind === 'supervisor') {
    return auth === 'local'
      ? caller.name === LOCAL_SUPERVISOR_NAME
      : auth !== 'cell';
  }
  return auth !== 'supervisor' && auth !== 'join' && auth !== 'local';
};

/** Constant-time equality of two tokens, so a wrong guess reveals nothing about the right one. */
const sameToken = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Who holds the token, among the credential classes the route accepts (PROTOCOL §1). The local
 * supervisor token is checked first, in memory: it is never stored, so no revoke is needed when the
 * server stops. Everything else is a runtime lookup.
 */
const lookupCaller = async (
  runtime: RuntimePort,
  auth: HttpAuth,
  token: string,
  localToken: string | undefined,
): Promise<Caller | undefined> => {
  const isLocal = localToken !== undefined && sameToken(token, localToken);
  if (auth === 'local') {
    return isLocal
      ? { kind: 'supervisor', name: LOCAL_SUPERVISOR_NAME }
      : undefined;
  }
  if (auth !== 'cell') {
    if (isLocal) return { kind: 'supervisor', name: LOCAL_SUPERVISOR_NAME };
    const name = await runtime.remote.supervisorName(token);
    if (name !== undefined) return { kind: 'supervisor', name };
  }
  if (auth !== 'supervisor' && auth !== 'join') {
    const cellId = await runtime.remote.cellOf(token);
    if (cellId !== undefined) return { kind: 'cell', cellId };
  }
  return undefined;
};

/**
 * Who holds the token (PROTOCOL §1), through the auth cache (perf-04): a verified caller the route
 * admits is served from memory; otherwise the runtime checks the credential and a positive result is
 * cached under the token's digest. A refusal is never cached.
 */
const callerOf = async (
  runtime: RuntimePort,
  cache: AuthCache,
  auth: HttpAuth,
  token: string,
  localToken: string | undefined,
): Promise<Caller | undefined> => {
  const digest = createHash('sha256').update(token).digest('hex');
  const cached = cache.get(digest, Date.now());
  if (cached !== undefined && admits(auth, cached)) return cached;
  const generation = cache.generation();
  const caller = await lookupCaller(runtime, auth, token, localToken);
  if (caller !== undefined) cache.set(digest, caller, generation, Date.now());
  return caller;
};

export interface AuthAdapterOptions {
  readonly runtime: RuntimePort;
  readonly cache: AuthCache;
  readonly localToken: string | undefined;
}

/** The credential check of PROTOCOL §1: a missing or unknown token refuses with `unauthorized`. */
export const createAuthAdapter = ({
  runtime,
  cache,
  localToken,
}: AuthAdapterOptions): AuthPort => ({
  authenticate: async (auth, token) => {
    const caller =
      token === undefined
        ? undefined
        : await callerOf(runtime, cache, auth, token, localToken);
    if (!caller) throw new RefusalError({ code: 'unauthorized' });
    return caller;
  },
});
