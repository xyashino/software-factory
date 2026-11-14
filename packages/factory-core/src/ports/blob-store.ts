import type { BlobRef } from '../ids';

export interface BlobStore {
  /** Stores bytes under their content address. Idempotent: a second put of the same ref is a no-op. */
  put(ref: BlobRef, bytes: Uint8Array, mediaType?: string): Promise<void>;
  get(ref: BlobRef): Promise<Uint8Array | undefined>;
  /** Size in bytes of each stored blob; refs that are not stored are absent from the map. */
  stat(refs: readonly BlobRef[]): Promise<Map<BlobRef, number>>;
}
