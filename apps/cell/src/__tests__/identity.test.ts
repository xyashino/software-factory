import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CellId } from '@repo/factory-core/ids';
import { newCellId } from '../ids';
import {
  deleteIdentity,
  IDENTITY_FILE_NAME,
  loadOrCreateIdentity,
} from '../identity';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-cell-identity-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('cell identity', () => {
  it('makes an identity once and keeps it on the next start', () => {
    const first = loadOrCreateIdentity(dir, newCellId);
    const again = loadOrCreateIdentity(dir, newCellId);

    expect(again.cellId).toBe(first.cellId);
  });

  it('stores the identity readable by its owner only', () => {
    loadOrCreateIdentity(dir, newCellId);

    const mode = statSync(join(dir, IDENTITY_FILE_NAME)).mode & 0o777;

    expect(mode).toBe(0o600);
  });

  it('makes a new identity after the stored one is deleted', () => {
    const first = loadOrCreateIdentity(dir, newCellId);
    deleteIdentity(dir);

    const next = loadOrCreateIdentity(dir, newCellId);

    expect(next.cellId).not.toBe(first.cellId);
  });

  it('replaces a file that does not hold an identity', () => {
    writeFileSync(join(dir, IDENTITY_FILE_NAME), 'not json');

    const identity = loadOrCreateIdentity(dir, () => '7'.repeat(26) as CellId);

    expect(identity.cellId).toBe('7'.repeat(26));
  });
});
