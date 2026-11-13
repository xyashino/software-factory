import type { BlobRef } from '../ids';

export interface BlobStore {
  put(ref: BlobRef, bytes: Uint8Array): Promise<void>;
  get(ref: BlobRef): Promise<Uint8Array | undefined>;
  /** Size in bytes of each stored blob; refs that are not stored are absent from the map. */
  stat(refs: readonly BlobRef[]): Promise<Map<BlobRef, number>>;
}
