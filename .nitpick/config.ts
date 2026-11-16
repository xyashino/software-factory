import { config } from '@repo/nitpick/config';
import { aodiFramework } from '@repo/nitpick/rules/aodi-framework';
import { decisionLog } from '@repo/nitpick/rules/decision-log';
import { richCommit } from '@repo/nitpick/rules/rich-commit';
import { mswBackendMocks } from '@repo/nitpick/rules/msw-backend-mocks';
import type { Importance } from '@repo/nitpick/config';

const md = (importance: Importance, path: string) => ({
  importance,
  doc: { file: `./rules/${path}.md`, inline: true },
});

export default config({
  output: [
    {
      path: '.agents',
      root: 'AGENTS.md',
      toc: { agents: false, skills: false },
      triggers: true,
    },
    { path: '.', root: 'CLAUDE.md', copy: true },
  ],
  entry: { doc: { file: './entry.md' } },
  settings: {
    mcpFiles: ['.mcp.json', '.cursor/mcp.json', '.agents/mcp_config.json'],
    mcp: {
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
    },
    permissions: {
      allow: [
        'mcp__playwright__*',
        'Bash(git checkout -b *)',
        'Bash(git switch -c *)',
        'Bash(git branch *)',
        'Bash(git add *)',
        'Bash(git commit *)',
        'Bash(git push -u origin *)',
        'Bash(git push origin *)',
      ],
    },
    attribution: { commit: '', pr: '' },
  },
  skills: {
    'async-implement': { source: './skills/async-implement' },
    'black-box-tester': { source: './skills/black-box-tester' },
    caveman: { source: './skills/caveman' },
    clarify: { source: './skills/clarify' },
    clone: { source: './skills/clone' },
    'create-pr': { source: './skills/create-pr' },
    'create-todo': { source: './skills/create-todo' },
    'do-ui': { source: './skills/do-ui' },
    evidence: { source: './skills/evidence' },
    'feature-workflow': { source: './skills/feature-workflow' },
    'boss-factory': { source: './skills/boss-factory' },
    'plan-be': { source: './skills/plan-be' },
    'plan-db': { source: './skills/plan-db' },
    'plan-domain': { source: './skills/plan-domain' },
    'plan-fe': { source: './skills/plan-fe' },
    'plan-requirements': { source: './skills/plan-requirements' },
    'run-workflow': { source: './skills/run-workflow' },
    'setup-factory': { source: './skills/setup-factory' },
    sloth: { source: './skills/sloth' },
    'vps-gon-stack': { source: './skills/vps-gon-stack' },
    'witch-doctor': { source: './skills/witch-doctor' },
  },
  refs: {
    'aodi-framework': aodiFramework,
  },
  rules: {
    git: {
      'rich-commit': richCommit,
      'git-no-artifacts': md('A', 'git/git-no-artifacts'),
    },
    testing: {
      'msw-backend-mocks': mswBackendMocks,
      'testing-black-box-aaa': md('A', 'testing/testing-black-box-aaa'),
      'testing-no-implementation-details': md(
        'I',
        'testing/testing-no-implementation-details',
      ),
      'testing-story-names': md('A', 'testing/testing-story-names'),
      'testing-no-gherkin': md('A', 'testing/testing-no-gherkin'),
      'testing-behaviors': md('A', 'testing/testing-behaviors'),
      'testing-ts-public-interface': md(
        'A',
        'testing/testing-ts-public-interface',
      ),
      'testing-no-internals': md('A', 'testing/testing-no-internals'),
      'testing-pyramid': md('A', 'testing/testing-pyramid'),
    },
    general: {
      'decision-log': decisionLog({
        scopes: [
          /^(repo|claude|nitpick|factory|software-factory|eslint-config|typescript-config|docs|ci)(\/[a-z][a-z0-9-]*)?$/,
        ],
      }),
      'general-minimal-text': md('A', 'general/general-minimal-text'),
      'general-prefer-ascii': md('I', 'general/general-prefer-ascii'),
      'general-caveman-markdown': md('A', 'general/general-caveman-markdown'),
      'general-follow-conventions': md(
        'A',
        'general/general-follow-conventions',
      ),
    },
    coding: {
      'coding-minimal-code': md('A', 'coding/coding-minimal-code'),
      'coding-minimal-comments': md('A', 'coding/coding-minimal-comments'),
      'coding-export-order': md('A', 'coding/coding-export-order'),
      'coding-no-barrel-export': md('A', 'coding/coding-no-barrel-export'),
    },
    security: {
      'security-sensitive-data': md('A', 'security/security-sensitive-data'),
    },
    typescript: {
      'ts-strict': md('A', 'typescript/ts-strict'),
      'ts-exhaustive': md('I', 'typescript/ts-exhaustive'),
      'ts-unknown-as': md('I', 'typescript/ts-unknown-as'),
    },
  },
});
