import { createHash } from 'node:crypto';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { BlobRef } from '@repo/factory-core/ids';

/** Uploads bytes under their sha256 ref (PROTOCOL §6): the same bytes are the same blob. */
export const putBlob = async (
  client: FactoryClient,
  bytes: Uint8Array,
  mediaType = 'text/markdown',
): Promise<BlobRef> => {
  const ref =
    `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;
  await client.call('blobPut', {
    ref,
    base64: Buffer.from(bytes).toString('base64'),
    mediaType,
  });
  return ref;
};

/** Downloads a blob's bytes by ref. */
export const getBlob = async (
  client: FactoryClient,
  ref: BlobRef,
): Promise<Uint8Array> => {
  const response = await client.call('blobGet', { ref });
  return Buffer.from(response.base64, 'base64');
};
