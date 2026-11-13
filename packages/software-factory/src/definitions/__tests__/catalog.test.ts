import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NitpickCatalog } from '../nitpick-catalog';
import type { Role } from '../types';
import { validateRoleCatalog } from '../validate';

const catalog = (): NitpickCatalog => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-nitpick-'));
  const skillsDir = join(dir, 'skills');
  mkdirSync(join(skillsDir, 'evidence'), { recursive: true });
  writeFileSync(join(skillsDir, 'evidence', 'SKILL.md'), '# evidence');
  return { ruleIds: new Set(['testing', 'rich-commit']), skillsDir };
};

const role = (rules: string[], skills: string[]): Role => {
  return {
    id: 'worker',
    label: 'Worker',
    verdict: false,
    rules,
    skills,
    artifacts: { report: 'report.md' },
    body: '',
    path: '/x/roles/worker.md',
  };
};

describe('validateRoleCatalog', () => {
  it('accepts rules and skills that exist', () => {
    const errors = validateRoleCatalog(
      'roles/worker.md',
      role(['testing', 'rich-commit'], ['evidence']),
      catalog(),
    );
    expect(errors).toEqual([]);
  });

  it('reports a rule missing from the nitpick config', () => {
    const errors = validateRoleCatalog(
      'roles/worker.md',
      role(['nope'], []),
      catalog(),
    );
    expect(errors).toEqual([
      {
        file: 'roles/worker.md',
        field: 'rules[0]',
        message: 'no rule nope in .nitpick/config.ts rules',
      },
    ]);
  });

  it('reports a skill directory without SKILL.md', () => {
    const known = catalog();
    mkdirSync(join(known.skillsDir, 'empty'));
    const errors = validateRoleCatalog(
      'roles/worker.md',
      role([], ['empty']),
      known,
    );
    expect(errors).toEqual([
      {
        file: 'roles/worker.md',
        field: 'skills[0]',
        message: 'no skill file .nitpick/skills/empty/SKILL.md',
      },
    ]);
  });
});
