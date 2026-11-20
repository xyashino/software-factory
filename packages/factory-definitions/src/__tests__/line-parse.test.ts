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

  it('accepts deliver.requireAdr as a boolean and rejects other values', () => {
    const base = readFileSync(VALID, 'utf8');
    const withFlag = base.replace(
      /deliver:\n/,
      'deliver:\n  requireAdr: true\n',
    );
    const parsed = parseLine({ file: FILE, path: VALID }, withFlag);
    if (!parsed.ok) throw new Error('requireAdr: true must parse');
    expect(parsed.value.deliver.requireAdr).toBe(true);

    const bad = base.replace(/deliver:\n/, 'deliver:\n  requireAdr: yes\n');
    expect(parseLine({ file: FILE, path: VALID }, bad).ok).toBe(false);
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

  it('fills the restart defaults: maxRestarts 1, maxLostRestarts 3', () => {
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
    });
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

  it('accepts a mechanic block and keeps it on the line', () => {
    const text = `${readFileSync(VALID, 'utf8')}\nmechanic:\n  profile: planner\n  runner: claude\n  model: sonnet\n  timeout: 20m\n  permission: read\n`;
    const parsed = parseLine({ file: FILE, path: VALID }, text);
    if (!parsed.ok) throw new Error('mechanic block must parse');
    expect(parsed.value.mechanic).toMatchObject({
      profile: 'planner',
      timeoutMs: 20 * 60_000,
      headless: false,
      permission: 'read',
    });
  });

  it('rejects an unknown key inside the mechanic block', () => {
    const text = `${readFileSync(VALID, 'utf8')}\nmechanic:\n  profile: planner\n  runner: claude\n  model: sonnet\n  timeout: 20m\n  colour: red\n`;
    const parsed = parseLine({ file: FILE, path: VALID }, text);
    expect(parsed.ok).toBe(false);
  });
});
