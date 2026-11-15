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
    expect(snapshot.stations[1]).toMatchObject({
      id: 'build',
      kind: 'operator',
      runner: 'claude',
      verdict: false,
      artifacts: ['commit', 'report'],
    });
    expect(snapshot.stations[3]).toMatchObject({ id: 'audit', verdict: true });
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
    expect(lineSnapshotSchema.safeParse(snapshotOf(validText)).success).toBe(
      true,
    );
  });

  it('gives the same hash when only the key order of the YAML changes', () => {
    const reordered = validText.replace(
      '    kind: operator\n    operator: planner',
      '    operator: planner\n    kind: operator',
    );
    expect(reordered).not.toBe(validText);
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
      'sha256:fb7b8b7658f304f89d02ab75848360963cde004fd0920427cd93b6b9b525f7ef',
    );
  });

  it.each([
    [
      'feature',
      'sha256:c60c6e26ea77618ad29af81800692460478e742850637b88b6a6ca4cac6b2890',
    ],
    [
      'fast',
      'sha256:beb68d2dee002d6ee37376ce4a18d57d46ec8603242acd9295c13b3d52489b44',
    ],
    [
      'standard',
      'sha256:f5110761ce0dddcb071826b0bfe2f17c5a4b2dfc3cf423ac2b02a9cd7fb093fd',
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
    expect(
      canonicalJson({ b: 1, a: { d: undefined, c: [{ z: 1, y: 2 }] } }),
    ).toBe('{"a":{"c":[{"y":2,"z":1}]},"b":1}');
  });

  it('keeps array order', () => {
    expect(canonicalJson(['b', 'a'])).toBe('["b","a"]');
  });
});
