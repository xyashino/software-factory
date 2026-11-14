import { createHash } from 'node:crypto';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { BlobRef } from '@repo/factory-core/ids';

/** The content address of bytes: `sha256:<hex>` (STORAGE §2). */
export const blobRefOf = (bytes: Uint8Array): BlobRef =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;

/**
 * Stores a note as a blob and returns its ref (PROTOCOL §3.2, `PUT /v1/blobs/:ref`). Uploads are
 * idempotent by construction: the ref is the hash of the bytes.
 */
export const putNote = async (
  client: FactoryClient,
  text: string,
): Promise<BlobRef> => {
  const bytes = new TextEncoder().encode(text);
  const ref = blobRefOf(bytes);
  await client.call('blobPut', {
    ref,
    base64: Buffer.from(bytes).toString('base64'),
    mediaType: 'text/plain; charset=utf-8',
  });
  return ref;
};
