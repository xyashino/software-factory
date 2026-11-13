import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLine } from '../line-schema';
import { validateLine } from '../line-validate';
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

const operators = readDefinitions(PACKAGE_ROOT).definitions.operators;

describe('parseLine (schema v2)', () => {
  it('parses the valid fixture with no errors', () => {
    const parsed = parseLine(
      { file: FILE, path: VALID },
      readFileSync(VALID, 'utf8'),
    );
    if (!parsed.ok) throw new Error('fixture must parse');
    expect(validateLine(FILE, parsed.value, operators)).toEqual([]);
  });

  it('turns durations into milliseconds and keeps sync and setup as workspace prep', () => {
    const parsed = parseLine(
      { file: FILE, path: VALID },
      readFileSync(VALID, 'utf8'),
    );
    if (!parsed.ok) throw new Error('fixture must parse');
    expect(parsed.value.workspace.sync?.timeoutMs).toBe(120_000);
    expect(parsed.value.workspace.setup.timeoutMs).toBe(600_000);
    expect(parsed.value.operators['planner']?.timeoutMs).toBe(1_200_000);
    expect(parsed.value).not.toHaveProperty('operator');
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
