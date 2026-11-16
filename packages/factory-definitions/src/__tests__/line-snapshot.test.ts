import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineSnapshotSchema } from '@repo/factory-core/line/snapshot';
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashLine, toLineSnapshot } from '../line-snapshot';
import { parseLine } from '../line-schema';
import { readDefinitions } from '../load';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const FACTORY_ROOT = join(PACKAGE_ROOT, '..', '..', '.factory');
const VALID = join(
  import.meta.dirname,
  'fixtures',
  'valid',
  'lines',
  'feature.yml',
);
const FILE = 'lines/feature.yml';

const { definitions } = readDefinitions(FACTORY_ROOT);
const operators = definitions.operators;

const snapshotOf = (text: string) => {
  const parsed = parseLine({ file: FILE, path: VALID }, text);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  const snapshot = toLineSnapshot(FILE, parsed.value, operators);
  if (!snapshot.ok) throw new Error(JSON.stringify(snapshot.error));
  return snapshot.value;
};

const validText = readFileSync(VALID, 'utf8');

describe('toLineSnapshot', () => {
  it('fills the restart defaults on every station', () => {
    const snapshot = snapshotOf(validText);
    for (const station of snapshot.stations) {
      expect(station.maxRestarts).toBe(1);
      expect(station.maxLostRestarts).toBe(3);
    }
  });

  it('takes the verdict and artifact keys from the operator profile', () => {
    const snapshot = snapshotOf(validText);
    expect(snapshot.stations[0]).toMatchObject({ id: 'plan', verdict: false });
    expect(snapshot.stations[1]).toMatchObject({ id: 'build', verdict: false });
    expect(snapshot.stations[3]).toMatchObject({ id: 'audit', verdict: true });
    expect(snapshot.stations[0]?.artifacts).toEqual(['plan']);
    expect(snapshot.stations[1]?.artifacts).toEqual(['commit', 'report']);
    expect(snapshot.stations[3]?.artifacts).toEqual(['feedback']);
  });

  it('carries each operator pool and the workspace, and no path', () => {
    const snapshot = snapshotOf(validText);
    const operator = snapshot.stations.find(
      (station) => station.kind === 'operator',
    );
    expect(operator?.operator?.model).toBeTruthy();
    expect(operator?.operator?.timeoutMs).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain(FACTORY_ROOT);
  });

  it('validates the result with the core snapshot schema', () => {
    const snapshot = snapshotOf(validText);
    expect(lineSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('gives the same hash when only the key order of the YAML changes', () => {
    const reordered = validText
      .replace('name: feature\n', '')
      .concat('\nname: feature\n');
    expect(snapshotOf(reordered).hash).toBe(snapshotOf(validText).hash);
  });

  it('gives a different hash when the content changes', () => {
    const changed = validText.replace('max: 3', 'max: 4');
    expect(snapshotOf(changed).hash).not.toBe(snapshotOf(validText).hash);
  });
});

describe('golden hashes', () => {
  it('pins the hash of the valid fixture line', () => {
    expect(snapshotOf(validText).hash).toBe(
      'sha256:72341ff72513d411e3e3efa3e69746f0354f9c75ab973e5c74e597628ba79878',
    );
  });

  it.each([
    [
      'feature',
      'sha256:7a9bc0fc287a7b4c5b2f37b26f75a96a7926b0a37d083f3a62a33db16f931b4b',
    ],
    [
      'fast',
      'sha256:1a9578c559dc35059e05ce0959a2ebd367703dd5f3812ae5c18e719115c31cf2',
    ],
    [
      'standard',
      'sha256:a619784289d17ff1dfbb643e090df2297455d5307206a381af2e700718bd6ac7',
    ],
  ])('pins the hash of the shipped %s line', (name, hash) => {
    expect(definitions.lines.get(name)?.snapshot.hash).toBe(hash);
  });
});

describe('hashLine and canonicalJson', () => {
  it('hashes the content without the hash field itself', () => {
    const snapshot = snapshotOf(validText);
    expect(hashLine({ ...snapshot, hash: 'sha256:' + '1'.repeat(64) })).toBe(
      snapshot.hash,
    );
  });

  it('sorts keys at every depth and drops undefined', () => {
    const a = canonicalJson({ b: 1, a: undefined, c: { y: 2, x: 3 } });
    const b = canonicalJson({ c: { x: 3, y: 2 }, b: 1 });
    expect(a).toBe(b);
  });

  it('keeps array order', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });
});
