import { config } from '@repo/nitpick/config';
import { aodiFramework } from '@repo/nitpick/rules/aodi-framework';
import { decisionLog } from '@repo/nitpick/rules/decision-log';
import { richCommit } from '@repo/nitpick/rules/rich-commit';
import { mswBackendMocks } from '@repo/nitpick/rules/msw-backend-mocks';

export default config({
  output: [
    {
      path: '.agents',
      root: 'AGENTS.md',
      toc: { agents: false, skills: false },
      triggers: true,
    },
  ],
  entry: {
    doc: ({ ref }) => `# Software Factory Agent Instructions

## English Language Feedback
- The user is working on improving their English.
- If the user makes a noticeable or major English mistake in their prompt, provide brief, friendly feedback at the very top of your response (1–2 bullet points or sentences).
- Keep the feedback concise and unobtrusive, then proceed with the normal task response.

## Software Factory Workflow
This repository follows an autonomous Software Factory workflow. The \`todos/\` backlog runs through \`pnpm factory\` (${ref('factory')}): execute and review per task, each role on its own agent CLI and model, one PR per task for dev acceptance. Interactive work goes to ${ref('worker')}, verified by ${ref('doctor')}.
Proof of work is recorded under \`.evidences/<task-id>/\` using ${ref('evidence')}.
Every completed change requires exactly one ADR entry in \`decisions/\`.`,
  },
  settings: {
    mcpFiles: ['.mcp.json', '.cursor/mcp.json', '.agents/mcp_config.json'],
    mcp: {
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
      a11y: { command: 'npx', args: ['-y', 'a11y-mcp'] },
    },
    permissions: {
      allow: [
        'mcp__playwright__*',
        'mcp__a11y__*',
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
  agents: {
    factory: {
      frontmatter: {
        name: 'factory',
        description:
          'Backlog runner — operates `pnpm factory`: todos/ queue, execute / review per task with the agent CLI set per role, one PR per task for dev acceptance.',
      },
      doc: ({ ref }) => `# Factory

The backlog runs as a program, not as a chat: \`pnpm factory\` (\`packages/factory\`). On the VPS a systemd timer starts it (${ref('vps-gon-stack')}). You help the dev feed and operate it. Never do the pipeline by hand.

## Queue (\`todos/\`)

Every \`todos/<id>.md\` starts with frontmatter (write new ones with ${ref('create-todo')}):

\`\`\`yaml
---
status: todo # todo | done | cancelled
priority: medium # high | medium | low
depends_on: [other-id] # optional, waits until those are done
type: feat # optional change category: feat | fix | chore | refactor | docs | test | perf | build | ci | style | revert (branch <type>/<id>)
execute: { runner: claude, tier: light } # optional override per role: execute | review
---
\`\`\`

- Defaults per role live in \`packages/factory/src/config/models.json\` \`roles\` (\`pnpm factory models\`). Optional \`runner\` (\`cursor | antigravity | claude | codex | opencode\`) and \`tier\` (\`advanced | default | light\`) override that row.
- Ready = \`status: todo\`, dependencies \`done\`, no open \`factory/<id>\` PR, no open \`factory-blocked\` issue. Order: priority, then id.

## One pass

1. Clean tree and no unpushed \`main\` commits, else stop (never drops dev work).
2. Per ready task, one at a time, on branch \`factory/<id>\` from \`origin/main\`:
   - execute (writes code, tests, one \`decisions/\` entry, proof, \`.evidences/<id>/commit.txt\`),
   - review (read-only) → \`VERDICT: pass | fail\`; fail goes back to execute with the problems,
   - pass → task set to \`status: done\`, commit through the normal hooks (hook failure goes back to execute), push, PR.
3. Dev accepts on the PR (merge) or closes it (task is picked again unless set to \`cancelled\` or changed).
4. Task cannot finish (rounds limit, timeout, no verdict, read-only agent edited files) → \`factory-blocked\` issue; close it to retry.
5. Agent CLI fails (signed out, missing) → the pass stops, nothing is reported as done.

## Commands

- \`pnpm factory --dry-run\`: ready tasks in order with the agent per role, nothing runs.
- \`pnpm factory\`: one pass (local or VPS). Base checkout must be on \`main\`; the pass runs \`git pull --ff-only\` first. \`depends_on\` unlocks only after the dependency PR is merged.
- VPS: \`systemctl --user enable --now omino-factory.timer\`, logs \`journalctl --user -u omino-factory -f\`.

## Rules

- Interactive single tasks go to ${ref('worker')}, then ${ref('doctor')}.
- Stop and yield on personal or sensitive data (\`rules/security.md\`).`,
    },
    worker: {
      frontmatter: {
        name: 'worker',
        description:
          'Does the work solo — short plan for complex tasks, test pyramid, basic repo checks, cheapest sufficient proof, then waits for dev acceptance.',
      },
      doc: ({ file, ref }) => `# Worker

Entry point from dev or factory. You know the catalog under \`rules/\`, \`skills/\`, \`references/\`, \`agents/\` — **do not load contents upfront**; read only when routing requires it.

Read before work:

- \`.agents/AGENTS.md\`
- ${file('aodi-framework')}

## Flow

1. Complex work (e.g. CRUD, many layers, DB + API + UI): write a short plan first.
2. Pick proof level now (${ref('evidence')} table), before first edit. If it needs BEFORE (time/interaction bug), capture it on untouched code first.
3. Execute yourself. Tests follow the **pyramid** (\`rules/testing.md\`).
4. Run **basic repo checks** (typecheck/lint/test for touched packages).
5. Show dev proof at the chosen level, cheapest sufficient. Wait for acceptance.

## Rules

- **Never delegate** (no workers, no subagents, no ${ref('doctor')}).
- **Never commit** (or push). Commit only after dev accepts, and not by worker.
- Ping dev on ambiguity, missing rules/skills in the catalog, or blockers.

## Output

- What changed, files touched, checks run, proof.
- Awaiting dev acceptance.`,
    },
    doctor: {
      frontmatter: {
        name: 'doctor',
        description:
          'After work — rules audit (with fixes), checks, proof it works, optional commit/push, cleanup.',
      },
      doc: ({ file }) => `# Doctor

Takes the worker's output. You finish quality, proof, and session closure.

## 1. Rules audit

- Match applicable \`rules/*.md\` to the changes (${file('aodi-framework')}).
- **Fix violations immediately** — do not report-only.
- Re-run **basic repo checks** after fixes.

## 2. Proof

Show dev adequate evidence the problem is solved, e.g.:

- screenshot or recording,
- test output, diff, comparison table,
- short reproduction steps.

## 3. Commit?

**Ask:** commit (+ push)? yes/no

### No

- Fix per feedback.
- New proof → ask again about commit.

### Yes

1. **Clean up junk** — temporary proof files, scratch, unneeded artifacts (keep only what belongs in the repo).
2. **Rules audit** on the final diff — fix again if needed.
3. **Decision log** — add a new \`decisions/YYYYMMDD-HHmmss-[<TICKET>-]<slug>.md\` for this session (datetime now, no number; format in \`rules/decision-log.md\`). Stage it with the code change.
4. Commit (\`rules/git.md\`) and push **only when dev asked for it**.
5. **Shut down** dev servers/ports you started this session (e.g. \`pnpm dev\`).

## Output

- Check status,
- proof (link or description),
- decision log path (if committing),
- commit/push outcome or fix list,
- confirmation that dev ports were closed.`,
    },
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
    sloth: { source: './skills/sloth' },
    socrates: { source: './skills/socrates' },
    'vps-gon-stack': { source: './skills/vps-gon-stack' },
    'witch-doctor': { source: './skills/witch-doctor' },
  },
  refs: {
    'aodi-framework': aodiFramework,
    'frontend-architecture': './references/frontend-architecture.md',
  },
  rules: {
    git: {
      'rich-commit': richCommit,
      'git-no-artifacts': {
        importance: 'A',
        doc: 'Never commit artifacts: videos, screenshots, recordings, logs, build/test output, scratch files',
      },
    },
    testing: {
      'msw-backend-mocks': mswBackendMocks,
      'testing-black-box-aaa': {
        importance: 'A',
        doc: 'Black Box/Arrange Act Assert organized',
      },
      'testing-no-implementation-details': {
        importance: 'I',
        doc: 'No implementation details',
      },
      'testing-story-names': {
        importance: 'A',
        doc: 'Short and "like user story" test names',
      },
      'testing-no-gherkin': { importance: 'A', doc: 'No Gherkin' },
      'testing-behaviors': {
        importance: 'A',
        doc: 'Test behaviors/not implementation',
      },
      'testing-ts-public-interface': {
        importance: 'A',
        doc: 'Verify TypeScript behavior in tests for public interface',
      },
      'testing-no-internals': {
        importance: 'A',
        doc: 'No internals testing, public behaviors only',
      },
      'testing-pyramid': { importance: 'A', doc: 'Test pyramid' },
    },
    general: {
      'decision-log': decisionLog({
        scopes: [
          /^(repo|claude|nitpick|factory|software-factory|eslint-config|typescript-config|docs|ci)(\/[a-z][a-z0-9-]*)?$/,
        ],
      }),
      'general-minimal-text': {
        importance: 'A',
        doc: 'Turbo minimal text',
      },
      'general-prefer-ascii': { importance: 'I', doc: 'Prefer ASCII' },
      'general-caveman-markdown': {
        importance: 'A',
        doc: 'Use `/caveman full` skill to reduce text inside any `markdown`',
      },
      'general-follow-conventions': {
        importance: 'A',
        doc: 'During modification follow conventions/style around',
      },
    },
    accessibility: {
      'a11y-wcag': { importance: 'A', doc: 'WCAG 2.2' },
      'a11y-aria': { importance: 'A', doc: 'Aria attributes' },
      'a11y-keyboard': {
        importance: 'A',
        doc: 'Full supported keyboard navigation',
      },
    },
    architecture: {
      'architecture-frontend': {
        importance: 'A',
        doc: ({ file }) => `Use ${file('frontend-architecture')} for frontend`,
      },
    },
    astro: {
      'astro-backend-endpoints': {
        importance: 'A',
        doc: 'Backend endpoints via built-in adapters and type-safe input/output validation',
      },
    },
    coding: {
      'coding-minimal-code': {
        importance: 'A',
        doc: 'Turbo minimal code',
      },
      'coding-export-order': {
        importance: 'A',
        doc: 'Inline exports. Declaration order top to bottom, one block per kind, never interleaved: (1) constants (private and exported together, a constant that module-level code reads at load time goes above its reader), (2) types/interfaces, (3) private helper functions, (4) exported functions. No `const` / `interface` / `const` alternation.',
      },
      'coding-no-barrel-export': {
        importance: 'A',
        doc: 'Never barrel export',
      },
    },
    frontend: {
      'frontend-csr-ssr': {
        importance: 'I',
        doc: 'When authentication required prefer `CSR`, otherwise `SSR/SSG`',
      },
    },
    react: {
      'react-use-effect-event': {
        importance: 'A',
        doc: '`useEffectEvent` instead of hacks',
      },
      'react-component-props': {
        importance: 'A',
        doc: '`ComponentProps` for generic components def merging',
      },
    },
    security: {
      'security-sensitive-data': {
        importance: 'A',
        doc: 'Yield and stop everything when any personal or sensitive data detected',
      },
    },
    styling: {
      'styling-no-raw-px': { importance: 'A', doc: 'No raw `px`' },
      'styling-design-tokens': { importance: 'A', doc: 'Design tokens' },
      'styling-no-direct-values': {
        importance: 'A',
        doc: 'No direct colors/spacing/z-index/fonts',
      },
      'styling-theming-single-file': {
        importance: 'A',
        doc: 'Theming in single app/lib file',
      },
    },
    typescript: {
      'ts-strict': { importance: 'A', doc: 'Type-safe & Strict' },
      'ts-exhaustive': {
        importance: 'I',
        doc: 'Exhaustive checking and discriminated property',
      },
    },
    ui: {
      'ui-mobile-first': { importance: 'A', doc: 'Mobile first & RWD' },
      'ui-dark-mode': { importance: 'A', doc: 'Dark mode supported' },
      'ui-a11y-customization': {
        importance: 'A',
        doc: 'Accessibility customization supported',
      },
      'ui-breakpoints': {
        importance: 'A',
        doc: 'Breakpoints supported in px: `320, 480, 640, 768, 1024, 1280, 1440, 1920`',
      },
      'ui-icons': { importance: 'A', doc: 'Icons via `lucide-react`' },
      'ui-scroll-gap': {
        importance: 'A',
        doc: 'Scrollable lists keep a proper gap between items and scrollbar',
      },
      'ui-dashboard-centered': {
        importance: 'A',
        doc: "Dashboard UI's with side panel should have all content centered in x-axis",
      },
      'ui-no-overlap': {
        importance: 'A',
        doc: 'No button/input/controls text overlap',
      },
    },
    ux: {
      'ux-error-pattern': {
        importance: 'A',
        doc: 'Proper errors display with pattern: `icon:title:tech-code:description:retry-option:back-option`',
      },
      'ux-skeleton': {
        importance: 'A',
        doc: 'Skeleton when loading app/modules/features that mimics current layout',
      },
      'ux-spinner': {
        importance: 'A',
        doc: 'Spinner in less important places, f.e: search inputs, button indicator',
      },
      'ux-optimistic-ui': {
        importance: 'A',
        doc: 'Optimistic UI and toasts when create/update/delete happens',
      },
      'ux-no-data-hide': {
        importance: 'A',
        doc: 'No data hide during reload, filters change. In that case loading banner',
      },
      'ux-no-jumping': { importance: 'A', doc: 'No jumping UI' },
      'ux-delete-confirmation': {
        importance: 'A',
        doc: 'Delete via confirmation',
      },
      'ux-no-results-message': {
        importance: 'A',
        doc: 'When filters applied and no data include normalized filters in message. F.e: `No results for "phrase"`',
      },
      'ux-empty-state': {
        importance: 'A',
        doc: 'Proper empty states display with pattern: `icon:title:description:primary-action`',
      },
    },
  },
});
