import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateIdentity } from '../identity';
import { newCellId } from '../ids';
import { claimInstanceDir, type InstanceClaim } from '../instance-lock';

let root: string;
let claims: InstanceClaim[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-instance-'));
  claims = [];
});

afterEach(() => {
  for (const claim of claims) claim.release();
  rmSync(root, { recursive: true, force: true });
});

describe('claimInstanceDir', () => {
  it('gives the base directory to the first process and isolated numbered dirs to concurrent ones', () => {
    const base = join(root, 'factory-cell');

    const first = claimInstanceDir(base);
    claims.push(first);
    const second = claimInstanceDir(base);
    claims.push(second);
    const third = claimInstanceDir(base);
    claims.push(third);

    expect(first.instance).toBe(1);
    expect(first.cellDataDir).toBe(resolve(base));

    expect(second.instance).toBe(2);
    expect(second.cellDataDir).toBe(`${resolve(base)}-2`);

    expect(third.instance).toBe(3);
    expect(third.cellDataDir).toBe(`${resolve(base)}-3`);
  });

  it('reuses a released instance directory when a new process starts', () => {
    const base = join(root, 'factory-cell');

    const first = claimInstanceDir(base);
    claims.push(first);
    const second = claimInstanceDir(base);

    second.release();
    const replacement = claimInstanceDir(base);
    claims.push(replacement);

    expect(replacement.instance).toBe(2);
    expect(replacement.cellDataDir).toBe(`${resolve(base)}-2`);

    first.release();
    const primary = claimInstanceDir(base);
    claims.push(primary);

    expect(primary.instance).toBe(1);
    expect(primary.cellDataDir).toBe(resolve(base));
  });

  it('gives concurrent instances separate cell identities', () => {
    const base = join(root, 'factory-cell');

    const first = claimInstanceDir(base);
    claims.push(first);
    const second = claimInstanceDir(base);
    claims.push(second);

    const id1 = loadOrCreateIdentity(first.cellDataDir, newCellId);
    const id2 = loadOrCreateIdentity(second.cellDataDir, newCellId);

    expect(id1.cellId).not.toBe(id2.cellId);
  });
});
