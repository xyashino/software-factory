import type { Runtime } from '@repo/factory-runtime/composition';
import { createAuthAdapter } from '../adapters/auth/auth.adapter';
import { type AuthCache, createAuthCache } from '../adapters/auth/auth-cache';
import type { TransportContext } from '../application/core/procedure';

export interface TransportOptions {
  readonly runtime: Runtime;
  readonly authCache?: AuthCache;
  readonly localToken?: string;
}

/**
 * Wires the application's ports to one runtime: the credential check (through the auth cache) and the
 * runtime facade. Every revoke, from any caller, drops the cached credentials it names.
 */
export const createTransport = ({
  runtime,
  authCache = createAuthCache(),
  localToken,
}: TransportOptions): TransportContext => {
  runtime.remote.onRevoked((revocation) => {
    if (revocation.kind === 'cell') authCache.evictCell(revocation.cellId);
    else authCache.clear();
  });
  return {
    runtime,
    auth: createAuthAdapter({ runtime, cache: authCache, localToken }),
  };
};
