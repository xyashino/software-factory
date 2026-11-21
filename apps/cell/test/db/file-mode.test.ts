import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDb } from '../../src/db/client';
import { createTempDbPath } from '../support/test-db';

describe('database file permissions', () => {
  it('keeps a new database file readable only by its owner', () => {
    const path = createTempDbPath();

    createDb(path);

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
