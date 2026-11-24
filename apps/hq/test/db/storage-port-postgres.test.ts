import { describe } from 'vitest';
import { createPostgresStorageAdapter } from '../../src/adapters/storage/postgres-storage.adapter';
import { POSTGRES_URL, resetPostgres } from '../support/postgres';
import { storagePortContract } from './storage-port.contract';

describe.skipIf(POSTGRES_URL === '')('storage port on postgres', () => {
  storagePortContract(async () => {
    const storage = await createPostgresStorageAdapter(POSTGRES_URL);
    await resetPostgres(POSTGRES_URL);
    return storage;
  });
});
