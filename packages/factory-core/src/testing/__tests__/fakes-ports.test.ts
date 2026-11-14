import { createHash } from 'node:crypto';
import { describe, it } from 'vitest';
import type { BlobRef } from '../../ids';
import { fakeBlobStore, fakeLeaseStore } from '../fakes-ports';
import { defineBlobStoreContract } from '../blob-contract';
import { defineLeaseStoreContract } from '../lease-contract';

const refOf = (bytes: Uint8Array): BlobRef =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}` as BlobRef;

defineLeaseStoreContract({ describe, it }, 'in-memory fake', async () => ({
  store: fakeLeaseStore(),
  seedCell: async () => undefined,
  close: async () => undefined,
}));

defineBlobStoreContract(
  { describe, it },
  'in-memory fake',
  refOf,
  async (clock) => ({
    store: fakeBlobStore({ refOf, clock }),
    close: async () => undefined,
  }),
);
