import { describe } from 'vitest';
import { createSqliteStorageAdapter } from '../../src/adapters/storage/sqlite-storage.adapter';
import { createTestDb } from '../support/test-db';
import { storagePortContract } from './storage-port.contract';

describe('storage port on sqlite', () => {
  storagePortContract(async () => createSqliteStorageAdapter(createTestDb()));
});
