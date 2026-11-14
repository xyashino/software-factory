// Blob size rules and the pure helpers around them (STORAGE §5). No I/O and no clock: gzip, hashing
// and the sweep belong to the adapter that owns the bytes.
import type { BlobRef } from './ids';

/** Text artifacts, prompts, Handovers and feedback: at most 2 MiB each. */
export const TEXT_MAX_BYTES = 2 * 1024 * 1024;
/** Inspection and setup logs: at most 20 MiB, larger logs are truncated before they are stored. */
export const LOG_MAX_BYTES = 20 * 1024 * 1024;
/** The adapter gzips blobs above this size (uncompressed bytes). */
export const GZIP_ABOVE_BYTES = 4 * 1024;
/** A blob no event references is deleted by the sweep once it is this old. */
export const SWEEP_AGE_MS = 24 * 60 * 60 * 1000;

export type BlobKind = 'text' | 'log';

/** The size limit of a kind of blob, in bytes. */
export const limitOf = (kind: BlobKind): number =>
  kind === 'log' ? LOG_MAX_BYTES : TEXT_MAX_BYTES;

/** A blob over its kind's limit. Typed so callers can tell it from a hash mismatch or an I/O error. */
export class BlobTooLargeError extends Error {
  constructor(
    readonly kind: BlobKind,
    readonly size: number,
    readonly limit: number,
  ) {
    super(`${kind} blob of ${size} bytes exceeds the ${limit}-byte limit`);
    this.name = 'BlobTooLargeError';
  }
}

const encoder = new TextEncoder();

/** Fixed width, so the kept bytes do not depend on how many bytes were dropped. */
const markerFor = (dropped: number): Uint8Array =>
  encoder.encode(
    `\n[... ${dropped.toString().padStart(12, '0')} bytes truncated ...]\n`,
  );

const MARKER_LENGTH = markerFor(0).byteLength;

/**
 * A log cut to `max` bytes: the head and the tail are kept, with a truncation marker between them.
 * A log that already fits is returned as it is.
 */
export const truncateLog = (
  bytes: Uint8Array,
  max: number = LOG_MAX_BYTES,
): Uint8Array => {
  if (bytes.byteLength <= max) return bytes;
  const kept = max - MARKER_LENGTH;
  const head = Math.floor(kept / 2);
  const tail = kept - head;
  const dropped = bytes.byteLength - kept;
  const out = new Uint8Array(max);
  out.set(bytes.subarray(0, head), 0);
  out.set(markerFor(dropped), head);
  out.set(bytes.subarray(bytes.byteLength - tail), head + MARKER_LENGTH);
  return out;
};

/**
 * The bytes to store for a blob of `kind`: a log is truncated to its limit, a text is returned as it
 * is and refused above its limit. Hash the result to get the ref the blob is stored under.
 */
export const fitBlob = (bytes: Uint8Array, kind: BlobKind): Uint8Array => {
  if (kind === 'log') return truncateLog(bytes, LOG_MAX_BYTES);
  if (bytes.byteLength > TEXT_MAX_BYTES) {
    throw new BlobTooLargeError('text', bytes.byteLength, TEXT_MAX_BYTES);
  }
  return bytes;
};

const BLOB_REF_IN_TEXT = /sha256:[0-9a-f]{64}/g;

/**
 * Every blob ref cited in a stored event payload (the JSON text). Events cite blobs by ref, so this is
 * the set the sweep must keep: a blob is referenced when any event payload contains its ref.
 */
export const blobRefsIn = (payloadJson: string): Set<BlobRef> =>
  new Set(
    [...payloadJson.matchAll(BLOB_REF_IN_TEXT)].map(
      (match) => match[0] as BlobRef,
    ),
  );
