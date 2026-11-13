import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDefinitions } from '../load';
import type { DefinitionError } from '../errors';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const REMOVE_LIST = 'REMOVE';

/** Exact load errors for each invalid fixture. Each fixture is the valid tree with one change. */
const EXPECTED: Record<string, DefinitionError[]> = {
  'commands-missing-timeout': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[2].timeout',
      message: 'is required',
    },
  ],
  'deliver-missing-artifact': [
    {
      file: 'workflows/feature.yml',
      field: 'deliver.commit',
      message: 'step "plan" does not produce artifact "commit"',
    },
  ],
  'deliver-task-ref': [
    {
      file: 'workflows/feature.yml',
      field: 'deliver.report',
      message: 'must be <stepId>.<artifactKey>',
    },
  ],
  'duration-format': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[2].timeout',
      message: 'must be a duration like 30s, 20m or 1h, got "1.5m"',
    },
  ],
  'duration-zero': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[2].timeout',
      message: 'must be a duration like 30s, 20m or 1h, got "0s"',
    },
  ],
  'input-bad-format': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[1].inputs[0]',
      message: 'must be <stepId>.<artifactKey>, <stepId>.gate or task.<field>',
    },
  ],
  'input-commands-step': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[3].inputs[1]',
      message:
        'step "quality-gate" is a commands step and produces no artifacts',
    },
  ],
  'input-gate-agent-step': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[3].inputs[1]',
      message:
        'step "plan" is an agent step; "plan.gate" needs a commands step',
    },
  ],
  'input-gate-later-step': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[1].inputs[1]',
      message: 'step "quality-gate" must come before this step',
    },
  ],
  'input-later-step': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[1].inputs[0]',
      message: 'step "audit" must come before this step',
    },
  ],
  'input-unknown-artifact': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[1].inputs[0]',
      message: 'step "plan" does not produce artifact "spec"',
    },
  ],
  'input-unknown-task-field': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[1].inputs[0]',
      message: 'unknown task input "task.title"; no task inputs are supported',
    },
  ],
  'judging-feedback-missing': [
    {
      file: 'roles/doctor.md',
      field: 'artifacts.feedback',
      message:
        'judging roles (verdict: true) must declare feedback: feedback.md',
    },
  ],
  'judging-feedback-name': [
    {
      file: 'roles/doctor.md',
      field: 'artifacts.feedback',
      message:
        'judging roles (verdict: true) must declare feedback: feedback.md',
    },
  ],
  'onfail-not-judging': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[1].onFail',
      message:
        'only a judging role (verdict: true) can fail a step; role "worker" is not judging',
    },
  ],
  'operator-missing': [
    {
      file: 'workflows/feature.yml',
      field: 'operator',
      message: 'is required',
    },
  ],
  'operator-judging-role': [
    {
      file: 'workflows/feature.yml',
      field: 'operator.role',
      message:
        'role "doctor" judges its step; the operator finishes with `sf done`',
    },
  ],
  'operator-unknown-role': [
    {
      file: 'workflows/feature.yml',
      field: 'operator.role',
      message: 'unknown role "ghost"',
    },
  ],
  'pool-unknown-role': [
    {
      file: 'workflows/feature.yml',
      field: 'agents.worker.role',
      message: 'unknown role "builder"',
    },
  ],
  'pool-unused-agent': [
    {
      file: 'workflows/feature.yml',
      field: 'agents.reviewer',
      message: 'is not used by any step',
    },
  ],
  'retry-commands-step': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[3].onFail.retry',
      message:
        '"quality-gate" is a commands step; retry must target an agent step',
    },
  ],
  'retry-max-range': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[3].onFail.max',
      message: 'must be a whole number from 1 to 5',
    },
  ],
  'retry-not-earlier': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[3].onFail.retry',
      message: '"audit" must be an earlier step',
    },
  ],
  'retry-unknown-step': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[3].onFail.retry',
      message: 'unknown step "rebuild"',
    },
  ],
  'role-artifact-path': [
    {
      file: 'roles/planner.md',
      field: 'artifacts.plan',
      message: 'must be a file name without directories',
    },
  ],
  'role-id-mismatch': [
    {
      file: 'roles/planner.md',
      field: 'id',
      message: 'must equal the file name "planner"',
    },
  ],
  'role-invalid-artifact-key': [
    {
      file: 'roles/planner.md',
      field: 'artifacts.Plan-File',
      message: 'must be camelCase, like "plan"',
    },
  ],
  'role-missing-frontmatter': [
    {
      file: 'roles/planner.md',
      field: 'frontmatter',
      message: 'missing frontmatter: the file must start with a --- block',
    },
  ],
  'role-missing-label': [
    {
      file: 'roles/planner.md',
      field: 'label',
      message: 'is required',
    },
  ],
  'role-no-artifacts': [
    {
      file: 'roles/planner.md',
      field: 'artifacts',
      message: 'must declare at least one artifact',
    },
  ],
  'role-unknown-key': [
    {
      file: 'roles/planner.md',
      field: 'colour',
      message: 'unknown key',
    },
  ],
  'role-unknown-variable': [
    {
      file: 'roles/doctor.md',
      field: 'template',
      message: 'unknown variable {{evidenceDr}}',
    },
  ],
  'setup-empty-exec': [
    {
      file: 'workflows/feature.yml',
      field: 'setup.exec',
      message: 'must list at least one command',
    },
  ],
  'step-id-duplicate': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[2].id',
      message: 'duplicate step id "build"',
    },
  ],
  'step-unknown-agent': [
    {
      file: 'workflows/feature.yml',
      field: 'steps[3].agent',
      message: 'unknown agent "reviewer"; declare it under agents:',
    },
    {
      file: 'workflows/feature.yml',
      field: 'agents.doctor',
      message: 'is not used by any step',
    },
  ],
  'steps-empty': [
    {
      file: 'workflows/feature.yml',
      field: 'steps',
      message: 'must contain at least one step',
    },
  ],
  'sync-empty-exec': [
    {
      file: 'workflows/feature.yml',
      field: 'sync.exec',
      message: 'must list at least one command',
    },
  ],
  'sync-missing-timeout': [
    {
      file: 'workflows/feature.yml',
      field: 'sync.timeout',
      message: 'is required',
    },
  ],
  'template-missing': [
    {
      file: 'templates/prompts/reminder-idle.md',
      field: '(file)',
      message: 'template file is missing',
    },
  ],
  'template-unknown-file': [
    {
      file: 'templates/prompts/extra.md',
      field: '(file)',
      message:
        '"extra" is not a known template; add it to TEMPLATE_VARS in src/prompts/templates.ts',
    },
  ],
  'template-unknown-variable': [
    {
      file: 'templates/prompts/gate-feedback.md',
      field: 'template',
      message: 'unknown variable {{branch}}',
    },
  ],
  'workflow-bad-permission': [
    {
      file: 'workflows/feature.yml',
      field: 'agents.doctor.permission',
      message: 'must be one of read, write',
    },
  ],
  'workflow-headless-no-print-mode': [
    {
      file: 'workflows/feature.yml',
      field: 'agents.doctor.headless',
      message:
        'runner "opencode" has no print mode; headless needs one that does',
    },
  ],
  'workflow-operator-headless': [
    {
      file: 'workflows/feature.yml',
      field: 'operator.headless',
      message: 'the operator needs a pane; headless is not allowed',
    },
  ],
  'workflow-read-no-read-mode': [
    {
      file: 'workflows/feature.yml',
      field: 'agents.doctor.permission',
      message:
        'runner "opencode" has no read-only mode; permission: read needs one that does',
    },
  ],
  'workflow-name-mismatch': [
    {
      file: 'workflows/feature.yml',
      field: 'name',
      message: 'must equal the file name "feature"',
    },
  ],
  'workflow-unknown-key': [
    {
      file: 'workflows/feature.yml',
      field: 'retries',
      message: 'unknown key',
    },
  ],
  'workflow-unknown-runner': [
    {
      file: 'workflows/feature.yml',
      field: 'agents.worker.runner',
      message: 'must be one of claude, codex, cursor, antigravity, opencode',
    },
  ],
  'workflow-yaml-syntax': [
    {
      file: 'workflows/feature.yml',
      field: 'yaml',
      message:
        'syntax error at line 10, column 3: Flow map in block collection must be sufficiently indented and end with a }',
    },
  ],
};

/** Copies the valid tree, applies one invalid case on top, and loads the result. */
const loadCase = (name: string) => {
  const root = mkdtempSync(join(tmpdir(), 'software-factory-'));
  try {
    cpSync(join(FIXTURES, 'valid'), root, { recursive: true });
    const caseDir = join(FIXTURES, 'invalid', name);
    const removeFile = join(caseDir, REMOVE_LIST);
    if (existsSync(removeFile)) {
      for (const path of readFileSync(removeFile, 'utf8')
        .split('\n')
        .filter(Boolean)) {
        rmSync(join(root, path));
      }
    }
    cpSync(caseDir, root, {
      recursive: true,
      filter: (source) => !source.endsWith(REMOVE_LIST),
    });
    return loadDefinitions(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe('invalid definitions', () => {
  it('has an expectation for every fixture folder', () => {
    const folders = readdirSync(join(FIXTURES, 'invalid')).sort();
    expect(Object.keys(EXPECTED).sort()).toEqual(folders);
  });

  it.each(Object.keys(EXPECTED))('rejects %s with the exact errors', (name) => {
    expect(loadCase(name)).toEqual({ ok: false, error: EXPECTED[name] });
  });
});
