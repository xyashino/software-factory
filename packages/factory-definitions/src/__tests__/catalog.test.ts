import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  catalogFromConfig,
  nitpickCatalog,
  readFactoryConfig,
  readRuleIds,
  resolveCatalog,
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
  return {
    ruleIds: new Set(['testing', 'rich-commit']),
    skillsDir,
    rulePaths: new Map(),
    skillPaths: new Map(),
  };
};

/** A repo root with a self-contained `.nitpick/config.ts` (no package imports), written by the test. */
const repoWithConfig = (config: string, skills: string[] = []): string => {
  const root = mkdtempSync(join(tmpdir(), 'sf-nitpick-repo-'));
  mkdirSync(join(root, '.nitpick'), { recursive: true });
  writeFileSync(join(root, '.nitpick', 'config.ts'), config);
  for (const id of skills) {
    mkdirSync(join(root, '.nitpick', 'skills', id), { recursive: true });
    writeFileSync(join(root, '.nitpick', 'skills', id, 'SKILL.md'), '# skill');
  }
  return root;
};

const CONFIG = `export default {
  output: [{ path: 'docs/ai' }, { path: 'other' }],
  rules: {
    git: { 'rich-commit': { doc: { title: 'Rich commit' } }, 'git-short': { doc: 'short' } },
    testing: { 'testing-unit': { doc: 'unit' }, 'testing-pyramid': { doc: { file: './p.md', inline: true } } },
  },
  skills: { evidence: { source: './skills/evidence' } },
};`;

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

  it('resolves this repo rules and skills to their .agents files', async () => {
    const catalog = await nitpickCatalog(REPO_ROOT);
    expect(catalog.rulePaths.get('rich-commit')).toBe(
      '.agents/rules/rich-commit.md',
    );
    expect(catalog.rulePaths.get('decision-log')).toBe(
      '.agents/rules/decision-log.md',
    );
    expect(catalog.rulePaths.get('testing')).toBe('.agents/rules/testing.md');
    expect(catalog.skillPaths.get('evidence')).toBe(
      '.agents/skills/evidence/SKILL.md',
    );
  });

  it('maps a standalone rule to its own file and a group rule to the group file', async () => {
    const root = repoWithConfig(CONFIG);
    const catalog = await nitpickCatalog(root);
    expect(catalog.rulePaths.get('rich-commit')).toBe(
      'docs/ai/rules/rich-commit.md',
    );
    expect(catalog.rulePaths.get('git-short')).toBe('docs/ai/rules/git.md');
    expect(catalog.rulePaths.get('git')).toBe('docs/ai/rules/git.md');
    expect(catalog.rulePaths.get('testing-unit')).toBe(
      'docs/ai/rules/testing.md',
    );
  });

  it('maps an inline file rule to the group file', async () => {
    const root = repoWithConfig(CONFIG);
    const catalog = await nitpickCatalog(root);
    expect(catalog.rulePaths.get('testing-pyramid')).toBe(
      'docs/ai/rules/testing.md',
    );
  });

  it('uses the first output path only', async () => {
    const root = repoWithConfig(CONFIG);
    const catalog = await nitpickCatalog(root);
    expect(
      [...catalog.rulePaths.values()].some((p) => p.startsWith('other/')),
    ).toBe(false);
  });

  it('points a synced skill at the output and an unsynced one at .nitpick', async () => {
    const root = repoWithConfig(
      `export default { output: [{ path: 'docs/ai' }], rules: {}, skills: { evidence: { source: './x' } } };`,
      ['evidence', 'local-only'],
    );
    mkdirSync(join(root, 'docs', 'ai', 'skills', 'evidence'), {
      recursive: true,
    });
    writeFileSync(
      join(root, 'docs', 'ai', 'skills', 'evidence', 'SKILL.md'),
      '# evidence',
    );
    const catalog = await nitpickCatalog(root);
    expect(catalog.skillPaths.get('evidence')).toBe(
      'docs/ai/skills/evidence/SKILL.md',
    );
    expect(catalog.skillPaths.get('local-only')).toBe(
      '.nitpick/skills/local-only/SKILL.md',
    );
  });

  it('defaults the output to .agents when the config names none', async () => {
    const root = repoWithConfig(
      `export default { rules: { testing: { 'testing-unit': { doc: 'unit' } } } };`,
    );
    const catalog = await nitpickCatalog(root);
    expect(catalog.rulePaths.get('testing-unit')).toBe(
      '.agents/rules/testing.md',
    );
  });

  it('publishes no paths for an output outside the repo', async () => {
    const root = repoWithConfig(
      `export default { output: [{ path: '../elsewhere' }], rules: { testing: { 'testing-unit': { doc: 'unit' } } } };`,
    );
    const catalog = await nitpickCatalog(root);
    expect(catalog.rulePaths.size).toBe(0);
    expect(catalog.skillPaths.size).toBe(0);
    expect(catalog.ruleIds.has('testing')).toBe(true);
  });
});

describe('Factory config catalog (config.json)', () => {
  it('reads .factory/config.json and builds catalog from configured base paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-factory-config-'));
    const factoryDir = join(root, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    writeFileSync(
      join(factoryDir, 'config.json'),
      JSON.stringify({ rules: './my-rules', skills: './my-skills' }),
    );

    // Create rules: one in root, one in group, one with frontmatter id
    mkdirSync(join(root, 'my-rules', 'backend'), { recursive: true });
    writeFileSync(join(root, 'my-rules', 'standalone.md'), '# Standalone rule');
    writeFileSync(
      join(root, 'my-rules', 'backend', 'db-access.md'),
      '# DB access rule',
    );
    writeFileSync(
      join(root, 'my-rules', 'custom.md'),
      '---\nid: custom-rule-id\n---\n# Custom rule',
    );

    // Create skills: one with SKILL.md, one without
    mkdirSync(join(root, 'my-skills', 'evidence'), { recursive: true });
    writeFileSync(
      join(root, 'my-skills', 'evidence', 'SKILL.md'),
      '# Evidence skill',
    );
    mkdirSync(join(root, 'my-skills', 'ignored-no-skill'), { recursive: true });

    const config = readFactoryConfig(factoryDir);
    expect(config).toEqual({ rules: './my-rules', skills: './my-skills' });
    if (!config) return;

    const direct = catalogFromConfig(root, config);
    expect(direct.ruleIds.has('standalone')).toBe(true);

    const catalog = await resolveCatalog(root);
    expect(catalog).toBeDefined();
    if (!catalog) return;

    expect(catalog.ruleIds.has('standalone')).toBe(true);
    expect(catalog.ruleIds.has('backend')).toBe(true);
    expect(catalog.ruleIds.has('db-access')).toBe(true);
    expect(catalog.ruleIds.has('custom-rule-id')).toBe(true);
    expect(catalog.rulePaths.get('standalone')).toBe('my-rules/standalone.md');
    expect(catalog.rulePaths.get('db-access')).toBe(
      'my-rules/backend/db-access.md',
    );
    expect(catalog.rulePaths.get('backend')).toBe('my-rules/backend');

    expect(catalog.skillPaths.has('evidence')).toBe(true);
    expect(catalog.skillPaths.get('evidence')).toBe(
      'my-skills/evidence/SKILL.md',
    );
    expect(catalog.skillPaths.has('ignored-no-skill')).toBe(false);
  });

  it('reads config from this repository with .factory/config.json', async () => {
    const catalog = await resolveCatalog(REPO_ROOT);
    expect(catalog).toBeDefined();
    if (!catalog) return;

    expect(catalog.ruleIds.has('rich-commit')).toBe(true);
    expect(catalog.ruleIds.has('decision-log')).toBe(true);
    expect(catalog.ruleIds.has('testing')).toBe(true);
    expect(catalog.skillPaths.has('evidence')).toBe(true);
    expect(catalog.skillPaths.get('evidence')).toBe(
      '.nitpick/skills/evidence/SKILL.md',
    );
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
