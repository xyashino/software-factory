import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  nitpickCatalog,
  readRuleIds,
  type NitpickCatalog,
} from '../nitpick-catalog';
import { validateOperatorCatalog } from '../operator-catalog';
import {
  parseOperatorProfile,
  type OperatorProfile,
} from '../operator-profile';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

const fakeCatalog = (): NitpickCatalog => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-nitpick-'));
  const skillsDir = join(dir, 'skills');
  mkdirSync(join(skillsDir, 'evidence'), { recursive: true });
  writeFileSync(join(skillsDir, 'evidence', 'SKILL.md'), '# evidence');
  mkdirSync(join(skillsDir, 'empty'));
  return { ruleIds: new Set(['testing', 'rich-commit']), skillsDir };
};

const profile = (rules: string[], skills: string[]): OperatorProfile => {
  const parsed = parseOperatorProfile(
    { file: 'operators/builder.md', path: '/x/operators/builder.md' },
    '---\nid: builder\nlabel: Builder\nartifacts:\n  report: report.md\n---\nBody\n',
  );
  if (!parsed.ok) throw new Error('fixture profile must parse');
  return { ...parsed.value, rules, skills };
};

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
      agents: { cell: {} },
    });
    expect([...ids]).toEqual(['git']);
  });

  it('returns nothing for a value without rules', () => {
    expect(readRuleIds(undefined).size).toBe(0);
    expect(readRuleIds({ rules: 'x' }).size).toBe(0);
  });
});

describe('nitpickCatalog', () => {
  it('reads the repo config from the root it is given', async () => {
    const catalog = await nitpickCatalog(REPO_ROOT);
    expect(catalog.ruleIds.has('rich-commit')).toBe(true);
    expect(catalog.ruleIds.has('testing')).toBe(true);
    expect(catalog.skillsDir).toBe(join(REPO_ROOT, '.nitpick', 'skills'));
  });
});

describe('validateOperatorCatalog', () => {
  it('accepts rules and skills that exist', () => {
    const errors = validateOperatorCatalog(
      'operators/builder.md',
      profile(['testing', 'rich-commit'], ['evidence']),
      fakeCatalog(),
    );
    expect(errors).toEqual([]);
  });

  it('reports a rule missing from the nitpick config, with file and field', () => {
    const errors = validateOperatorCatalog(
      'operators/builder.md',
      profile(['nope'], []),
      fakeCatalog(),
    );
    expect(errors).toEqual([
      {
        file: 'operators/builder.md',
        field: 'rules[0]',
        message: 'no rule nope in .nitpick/config.ts rules',
      },
    ]);
  });

  it('reports a skill directory without SKILL.md', () => {
    const errors = validateOperatorCatalog(
      'operators/builder.md',
      profile([], ['empty']),
      fakeCatalog(),
    );
    expect(errors).toEqual([
      {
        file: 'operators/builder.md',
        field: 'skills[0]',
        message: 'no skill file .nitpick/skills/empty/SKILL.md',
      },
    ]);
  });
});
