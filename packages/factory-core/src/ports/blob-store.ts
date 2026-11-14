import type { BlobKind } from '../blob-rules';
import type { BlobRef } from '../ids';

export interface BlobStore {
  /**
   * Stores bytes under their content address. The bytes are fitted to the rules of `kind` first (`fitBlob`:
   * a log over 20 MiB is truncated head + tail, a text over 2 MiB throws `BlobTooLargeError`). `ref` must
   * be the hash of the fitted bytes, so the stored bytes always hash to their ref; otherwise it throws.
   * Idempotent: a second put of the same ref is a no-op.
   */
  put(
    ref: BlobRef,
    bytes: Uint8Array,
    mediaType?: string,
    kind?: BlobKind,
  ): Promise<void>;
  get(ref: BlobRef): Promise<Uint8Array | undefined>;
  /** Uncompressed size in bytes of each stored blob; refs that are not stored are absent from the map. */
  stat(refs: readonly BlobRef[]): Promise<Map<BlobRef, number>>;
  /**
   * Deletes the blobs not in `referenced` that were created at or before `now - SWEEP_AGE_MS`.
   * Returns the refs deleted. The caller collects `referenced` from the events (`blobRefsIn`).
   */
  sweep(now: number, referenced: ReadonlySet<BlobRef>): Promise<BlobRef[]>;
}
