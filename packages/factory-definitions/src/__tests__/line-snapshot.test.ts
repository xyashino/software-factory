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
      'sha256:3d6cf89d6de468d44a3fdeb2de682de862bf9c3b9eb4433e79a78b35081e34f2',
    );
  });

  it.each([
    [
      'feature',
      'sha256:b4c6e0ddb831b9c7bcc9891190b9fe94c191214eab8681dddf58a52b3d1c6a23',
    ],
    [
      'fast',
      'sha256:e3a265b23ce16b9b948374238d2f9ad2ca524836fdc98826186d9d799c9975ed',
    ],
    [
      'standard',
      'sha256:9547d4b20d95b5863e030d6c74fb2163670278ed2ee345576d99108c8a0082e1',
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
