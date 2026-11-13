import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nitpickCatalog, readRuleIds } from '../nitpick-catalog';

describe('readRuleIds', () => {
  it('finds group and rule keys', () => {
    const ids = readRuleIds({
      rules: { git: { 'rich-commit': {} }, testing: { 'testing-unit': {} } },
    });
    expect([...ids].sort()).toEqual([
      'git',
      'rich-commit',
      'testing',
      'testing-unit',
    ]);
  });

  it('ignores keys outside rules', () => {
    const ids = readRuleIds({
      rules: { git: {} },
      skills: { evidence: {} },
      agents: { worker: {} },
    });
    expect([...ids]).toEqual(['git']);
  });

  it('returns nothing for a value without rules', () => {
    expect(readRuleIds(undefined).size).toBe(0);
    expect(readRuleIds({ rules: 'x' }).size).toBe(0);
  });
});

describe('nitpickCatalog', () => {
  it('reads the repo config', async () => {
    const root = join(import.meta.dirname, '..', '..', '..', '..', '..');
    const catalog = await nitpickCatalog(root);
    expect(catalog.ruleIds.has('rich-commit')).toBe(true);
    expect(catalog.ruleIds.has('testing')).toBe(true);
    expect(catalog.skillsDir).toBe(join(root, '.nitpick', 'skills'));
  });
});
