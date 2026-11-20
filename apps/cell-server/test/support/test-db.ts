import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type Db } from '../../src/db/client';

export const createTestDb = (): Db => createDb(':memory:');

export const createTempDbPath = (): string =>
  join(mkdtempSync(join(tmpdir(), 'cell-server-')), 'cell-server.db');
