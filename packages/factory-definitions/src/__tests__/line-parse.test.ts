import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLine } from '../line-schema';
import { validateLine } from '../line-validate';
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

const operators = readDefinitions(FACTORY_ROOT).definitions.operators;

describe('parseLine (schema v2)', () => {
  it('parses the valid fixture with no errors', () => {
    const parsed = parseLine(
      { file: FILE, path: VALID },
      readFileSync(VALID, 'utf8'),
    );
    if (!parsed.ok) throw new Error('fixture must parse');
    expect(validateLine(FILE, parsed.value, operators)).toEqual([]);
  });

  it('turns durations into milliseconds and keeps sync and changeover as workspace prep', () => {
    const parsed = parseLine(
      { file: FILE, path: VALID },
      readFileSync(VALID, 'utf8'),
    );
    if (!parsed.ok) throw new Error('fixture must parse');
    expect(parsed.value.workspace.sync?.timeoutMs).toBe(120_000);
    expect(parsed.value.workspace.changeover?.timeoutMs).toBe(600_000);
    expect(parsed.value.workspace.changeover?.keyFiles).toEqual([
      'pnpm-lock.yaml',
    ]);
    expect(parsed.value.operators['planner']?.timeoutMs).toBe(1_200_000);
    expect(parsed.value).not.toHaveProperty('operator');
    expect(parsed.value).not.toHaveProperty('workspace.setup');
  });

  it('reads deliver changeover false as an opt-out, and leaves it unset when absent', () => {
    const parsed = parseLine(
      { file: FILE, path: VALID },
      readFileSync(VALID, 'utf8'),
    );
    if (!parsed.ok) throw new Error('fixture must parse');
    expect(parsed.value.deliver.changeover).toBe(false);
    expect(parsed.value.stations[0]?.changeover).toBeUndefined();
  });

  /** The valid fixture with one text swapped. The swapped text must occur exactly once. */
  const withText = (from: string, to: string) => {
    const text = readFileSync(VALID, 'utf8');
    if (text.split(from).length !== 2) throw new Error(`no unique ${from}`);
    return text.replace(from, () => to);
  };

  it('parses a station changeover block into milliseconds with its own key files', () => {
    const text = withText(
      '  - id: plan\n    kind: operator\n    operator: planner\n    inputs: []\n',
      '  - id: plan\n    kind: operator\n    operator: planner\n    inputs: []\n    changeover:\n      timeout: 5m\n      exec:\n        - pnpm install\n      keyFiles:\n        - package.json\n',
    );
    const parsed = parseLine({ file: FILE, path: VALID }, text);
    if (!parsed.ok) throw new Error('fixture must parse');
    expect(parsed.value.stations[0]?.changeover).toEqual({
      timeoutMs: 300_000,
      exec: ['pnpm install'],
      keyFiles: ['package.json'],
    });
  });

  it('rejects an empty keyFiles list: a key file list is either absent or non-empty', () => {
    const text = withText(
      '    keyFiles:\n      - pnpm-lock.yaml\n',
      '    keyFiles: []\n',
    );
    const parsed = parseLine({ file: FILE, path: VALID }, text);
    expect(parsed.ok).toBe(false);
  });

  it('rejects a key file that is absolute or climbs out of the repository', () => {
    const text = withText('      - pnpm-lock.yaml\n', '      - /etc/passwd\n');
    const parsed = parseLine({ file: FILE, path: VALID }, text);
    expect(parsed.ok).toBe(false);
  });

  it('fills the restart defaults: maxRestarts 1, maxLostRestarts 3, requires []', () => {
    const parsed = parseLine(
      { file: FILE, path: VALID },
      readFileSync(VALID, 'utf8'),
    );
    if (!parsed.ok) throw new Error('fixture must parse');
    const plan = parsed.value.stations[0];
    expect(plan).toMatchObject({
      id: 'plan',
      kind: 'operator',
      maxRestarts: 1,
      maxLostRestarts: 3,
      requires: [],
    });
    expect(parsed.value.stations[1]?.requires).toEqual(['docker']);
  });

  it('defaults operator headless to false and permission to write', () => {
    const parsed = parseLine(
      { file: FILE, path: VALID },
      readFileSync(VALID, 'utf8'),
    );
    if (!parsed.ok) throw new Error('fixture must parse');
    expect(parsed.value.operators['planner']).toMatchObject({
      headless: false,
      permission: 'write',
    });
  });
});
