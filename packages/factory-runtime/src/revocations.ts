import type { CellId } from '@repo/factory-core/ids';

/**
 * A credential the runtime revoked, after the revoke committed. Listeners drop what they cached about
 * it (the server's auth cache, perf-04). Every revoke comes through the runtime, from the socket or HTTP.
 */
export type Revocation =
  { kind: 'cell'; cellId: CellId } | { kind: 'joinToken'; joinTokenId: string };

export interface Revocations {
  /** Tells every listener, in subscription order. A listener is never asked to throw. */
  emit(revocation: Revocation): void;
  /** Subscribes to revocations; the returned function unsubscribes. */
  subscribe(listener: (revocation: Revocation) => void): () => void;
}

/** One feed per runtime: the operations that revoke emit into it, the transports subscribe to it. */
export const revocations = (): Revocations => {
  const listeners = new Set<(revocation: Revocation) => void>();
  return {
    emit: (revocation) => {
      for (const listener of [...listeners]) listener(revocation);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
