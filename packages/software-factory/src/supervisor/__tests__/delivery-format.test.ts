import { describe, expect, it } from 'vitest';
import { formatPrBody, extractObjective } from '../format-pr-body';
import { loadPrTemplates } from '../../prompts/templates';
import { PACKAGE_ROOT } from '../../paths';
import { commitTitle, validateCommitMessage } from '../delivery-commit';
import { adrPaths, validateDeliveryState } from '../validate-pr';

describe('commit messages', () => {
  it('accepts a conventional subject with a scope', () => {
    expect(
      validateCommitMessage('feat(software-factory): add delivery\n\n- done'),
    ).toEqual([]);
  });

  it('rejects a subject without a scope or type', () => {
    expect(validateCommitMessage('add delivery')).toHaveLength(1);
    expect(validateCommitMessage('feat: add delivery')).toHaveLength(1);
  });

  it('takes the first line as the title', () => {
    expect(commitTitle('fix(x): y\n\n- a')).toBe('fix(x): y');
  });
});

describe('delivery state', () => {
  it('refuses uncommitted files', () => {
    expect(
      validateDeliveryState({
        uncommitted: ['a.ts'],
        added: ['decisions/1.md'],
      }),
    ).toEqual(['worktree still has uncommitted files: a.ts']);
  });

  it('requires exactly one new decision for a new PR', () => {
    expect(
      validateDeliveryState({ uncommitted: [], added: ['a.ts'] }),
    ).toHaveLength(1);
    expect(
      validateDeliveryState({
        uncommitted: [],
        added: ['decisions/1.md', 'decisions/2.md'],
      }),
    ).toHaveLength(1);
    expect(
      validateDeliveryState({ uncommitted: [], added: ['decisions/1.md'] }),
    ).toEqual([]);
  });

  it('lists only decisions/ markdown entries', () => {
    expect(
      adrPaths(['decisions/1.md', 'decisions/README.txt', 'src/x.ts']),
    ).toEqual(['decisions/1.md']);
  });
});

describe('PR body', () => {
  const loaded = loadPrTemplates(PACKAGE_ROOT);
  if (loaded.errors.length > 0) throw new Error(JSON.stringify(loaded.errors));
  const templates = loaded.templates;

  const todo = [
    '---',
    'status: todo',
    'type: feat',
    '---',
    '',
    '# Todo: hello',
    '',
    '## 🎯 Objective',
    '',
    'Add a hello script.',
    '',
    '## Notes',
    '',
    'Later.',
    '',
  ].join('\n');

  it('takes the objective section of the todo', () => {
    expect(
      extractObjective(
        '## 🎯 Objective\n\nAdd a hello script.\n\n## Notes\n\nLater.',
      ),
    ).toBe('Add a hello script.');
  });

  it('builds the summary, change list, ADR and report from the artifacts', () => {
    const body = formatPrBody(
      {
        taskId: 'hello',
        todoText: todo,
        commitMessage: 'feat(hello): add script\n\n- print hello\n- add test',
        report: '- added hello.sh',
        adrPath: 'decisions/20261111-hello.md',
        logCommand: 'sf log hello',
        verification: [{ label: '`pnpm test`', passed: true }],
      },
      templates,
    );

    expect(body).toContain('Task: `hello` (feat)');
    expect(body).toContain('Add a hello script.');
    expect(body).toContain('- print hello\n- add test');
    expect(body).toContain('- Path: `decisions/20261111-hello.md`');
    expect(body).toContain('- added hello.sh');
    expect(body).toContain('sf log hello');
  });

  it('says so when there is no ADR or report', () => {
    const body = formatPrBody(
      {
        taskId: 'hello',
        todoText: todo,
        commitMessage: 'feat(hello): add script',
        logCommand: 'sf log hello',
        verification: [],
      },
      templates,
    );
    expect(body).toContain('No decisions/ entry recorded');
    expect(body).not.toContain('Worker report');
  });

  it('renders the checklist from results, never checking a step that did not pass', () => {
    const body = formatPrBody(
      {
        taskId: 'hello',
        todoText: todo,
        commitMessage: 'feat(hello): add script',
        logCommand: 'sf log hello',
        verification: [
          { label: '`pnpm check-types`', passed: true },
          { label: '`pnpm test`', passed: false },
          { label: 'Agent step `audit` (doctor)', passed: false },
        ],
      },
      templates,
    );
    expect(body).toContain('- [x] `pnpm check-types`');
    expect(body).toContain('- [ ] `pnpm test`');
    expect(body).toContain('- [ ] Agent step `audit` (doctor)');
    expect(body).not.toMatch(/- \[x\] (Doctor|Test|Lint|Typecheck)/);
  });

  it('renders the exact layout without a report', () => {
    const body = formatPrBody(
      {
        taskId: 'hello',
        todoText: todo,
        commitMessage: 'feat(hello): add script',
        logCommand: 'sf log hello',
        verification: [],
      },
      templates,
    );
    expect(body).toBe(
      [
        '## 🎯 Summary',
        '',
        'Task: `hello` (feat)',
        '',
        'Add a hello script.',
        '',
        '### Changes',
        '',
        '_No change list recorded in `commit.txt`._',
        '',
        '## 🏛️ Architecture Decision (ADR)',
        '',
        '_No decisions/ entry recorded for this change._',
        '',
        '## 🧪 Verification & Quality Gate',
        '',
        '_No verification steps in the workflow._',
        '',
        'Event log: `sf log hello`',
        '',
      ].join('\n'),
    );
  });

  it('renders the report in a details block after the event log', () => {
    const body = formatPrBody(
      {
        taskId: 'hello',
        todoText: todo,
        commitMessage: 'feat(hello): add script\n\n- print hello',
        report: '  - added hello.sh  \n',
        logCommand: 'sf log hello',
        verification: [{ label: '`pnpm test`', passed: true }],
      },
      templates,
    );
    expect(
      body.endsWith(
        'Event log: `sf log hello`\n\n<details>\n<summary>Worker report</summary>\n\n- added hello.sh\n\n</details>\n',
      ),
    ).toBe(true);
  });

  it('truncates a long report to 4000 characters', () => {
    const body = formatPrBody(
      {
        taskId: 'hello',
        todoText: todo,
        commitMessage: 'feat(hello): add script',
        report: 'x'.repeat(4005),
        logCommand: 'sf log hello',
        verification: [],
      },
      templates,
    );
    expect(body).toContain(`${'x'.repeat(4000)}\n\n_(truncated)_`);
    expect(body).not.toContain('x'.repeat(4001));
  });
});
