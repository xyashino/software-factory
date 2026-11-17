import type { CellId } from '@repo/factory-core/ids';
import type { Caller } from '../../application/ports/auth.port';

/**
 * The longest a verified credential stays cached without a fresh check. Revocations evict at once
 * (`revoked`); this bounds anything that bypasses them, such as a supervisor token, which has no revoke.
 */
export const AUTH_CACHE_TTL_MS = 30_000;

export interface AuthCache {
  /** Bumped by every eviction. A lookup that started before an eviction must not store its result. */
  generation(): number;
  /** The caller a digest verified to, while the entry is fresh; undefined otherwise. */
  get(digest: string, now: number): Caller | undefined;
  /** Stores a positive result, unless an eviction happened since `generation` was read. */
  set(digest: string, caller: Caller, generation: number, now: number): void;
  /** Drops every entry that names the Cell, at once. */
  evictCell(cellId: CellId): void;
  /** Drops every entry. */
  clear(): void;
}

/**
 * The in-memory cache of verified credentials (perf-04): `sha256(token)` to the caller it verified to,
 * so a heartbeat, a claim or a command does not hash and look up the credential on every request.
 * Only positive results are stored: a wrong or unknown token is never cached, so a new credential
 * is accepted at once. The raw token is never stored, only its digest.
 */
export const createAuthCache = (ttlMs = AUTH_CACHE_TTL_MS): AuthCache => {
  const entries = new Map<string, { caller: Caller; expiresAt: number }>();
  let generationNow = 0;
  return {
    generation: () => generationNow,
    get: (digest, now) => {
      const entry = entries.get(digest);
      if (!entry) return undefined;
      if (entry.expiresAt <= now) {
        entries.delete(digest);
        return undefined;
      }
      return entry.caller;
    },
    set: (digest, caller, generation, now) => {
      if (generation !== generationNow) return;
      entries.set(digest, { caller, expiresAt: now + ttlMs });
    },
    evictCell: (cellId) => {
      generationNow += 1;
      for (const [digest, entry] of entries) {
        if (entry.caller.kind === 'cell' && entry.caller.cellId === cellId) {
          entries.delete(digest);
        }
      }
    },
    clear: () => {
      generationNow += 1;
      entries.clear();
    },
  };
};
