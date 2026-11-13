import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineSnapshotSchema } from '@repo/factory-core/line/snapshot';
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashLine, toLineSnapshot } from '../line-snapshot';
import { parseLine } from '../line-schema';
import { readDefinitions } from '../load';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const VALID = join(
  import.meta.dirname,
  'fixtures',
  'valid',
  'lines',
  'feature.yml',
);
const FILE = 'lines/feature.yml';

const { definitions } = readDefinitions(PACKAGE_ROOT);
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

  it('keeps no operator details, paths or workspace in the snapshot', () => {
    const json = JSON.stringify(snapshotOf(validText));
    expect(json).not.toContain('timeout');
    expect(json).not.toContain('model');
    expect(json).not.toContain(PACKAGE_ROOT);
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
      'sha256:ac32b80be47342ef04bb929994902e444b23fad6f1abe58d54cc7c69560660e8',
    );
  });

  it.each([
    [
      'feature',
      'sha256:58154b61755ea5203d900b2e0d8b090227755b572bedda8741625532348391e5',
    ],
    [
      'fast',
      'sha256:3e3af31acdb16928455a25a597fa5e0ec7fe56268c8895249febf2de5d8f6d3f',
    ],
    [
      'standard',
      'sha256:67f0b80adf5270b16ed9fd1eaaa482f5a693293b730e842912c81d6f4342e6d4',
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
