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
      'sha256:eba3849c76beadee58cccb8a86cd594ebd6ca88c014880804ca15a45a0d459d4',
    ],
    [
      'fast',
      'sha256:375b0ff0eb67ba0b9f6e4d82c8caaee93ceafef27248134002434e6c5a46d264',
    ],
    [
      'standard',
      'sha256:e6c73920c609dfee4621a8ff1a498acbf0cec31cd8e6178d6b1a1407460e520e',
    ],
  ])('pins the hash of the shipped %s line', (name, hash) => {
    expect(definitions.lines.get(name)?.snapshot.hash).toBe(hash);
  });

  it('carries requireAdr into the snapshot of the lines that set it', () => {
    expect(definitions.lines.get('feature')?.snapshot.deliver).toMatchObject({
      requireAdr: true,
    });
    expect(definitions.lines.get('fast')?.snapshot.deliver).not.toHaveProperty(
      'requireAdr',
    );
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
