import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DefinitionError } from '../definitions/errors';
import { listFiles } from '../definitions/files';
import type { Template } from '../definitions/types';
import { templateVariables } from './render';

const PROMPT_DIR = 'templates/prompts';
const PR_DIR = 'templates/pr';

/** The variables each supervisor template may use. The supervisor fills exactly these. */
export const TEMPLATE_VARS = {
  'cli-guide': ['commands'],
  'context-input': ['ref', 'content'],
  'gate-pass': ['step', 'attemptId', 'commands'],
  'context-input-path': ['ref', 'path', 'size'],
  'review-feedback': ['step', 'retry', 'max', 'feedback'],
  'gate-feedback': ['command', 'exitCode', 'tail', 'logPath', 'retry', 'max'],
  'reminder-idle': ['missing', 'count', 'limit'],
  'nudge-silent': ['minutes'],
  answer: ['question', 'answer'],
  'context-note': ['from', 'text'],
  incident: ['reason', 'detail', 'pane', 'feedback'],
} as const satisfies Record<string, readonly string[]>;

/** The variables each PR template may use. The supervisor fills exactly these. */
export const PR_TEMPLATE_VARS = {
  body: [
    'taskId',
    'typeSuffix',
    'objective',
    'changes',
    'adrSection',
    'verificationSection',
    'logCommand',
    'reportSection',
  ],
  blocked: ['taskId', 'reason', 'detail', 'logCommand'],
  report: ['excerpt'],
} as const satisfies Record<string, readonly string[]>;

export interface LoadedTemplates {
  templates: Map<string, Template>;
  errors: DefinitionError[];
}

/** Reads every supervisor prompt template and checks its variables against TEMPLATE_VARS. */
export const loadTemplates = (packageRoot: string): LoadedTemplates => {
  return readTemplateDir(
    packageRoot,
    PROMPT_DIR,
    TEMPLATE_VARS,
    'TEMPLATE_VARS',
  );
};

/** Reads every PR markdown template and checks its variables against PR_TEMPLATE_VARS. */
export const loadPrTemplates = (packageRoot: string): LoadedTemplates => {
  return readTemplateDir(
    packageRoot,
    PR_DIR,
    PR_TEMPLATE_VARS,
    'PR_TEMPLATE_VARS',
  );
};

/**
 * Reads each `<id>.md` in `dir` and checks it against `vars`: every file must be
 * a declared id, every declared id must have a file, and every placeholder must
 * be declared. Declared variables a template does not use are reported too.
 */
const readTemplateDir = (
  packageRoot: string,
  dir: string,
  vars: Record<string, readonly string[]>,
  varsName: string,
): LoadedTemplates => {
  const templates = new Map<string, Template>();
  const errors: DefinitionError[] = [];
  const files = listFiles(packageRoot, dir, '.md');

  if (files === null) {
    return {
      templates,
      errors: [
        { file: dir, field: '(directory)', message: 'directory not found' },
      ],
    };
  }

  for (const file of files) {
    const id = basename(file, '.md');
    if (!Object.hasOwn(vars, id)) {
      errors.push({
        file,
        field: '(file)',
        message: `"${id}" is not a known template; add it to ${varsName} in src/prompts/templates.ts`,
      });
    }
  }

  for (const [id, allowed] of Object.entries(vars)) {
    const file = `${dir}/${id}.md`;
    const path = join(packageRoot, file);
    if (!existsSync(path)) {
      errors.push({
        file,
        field: '(file)',
        message: 'template file is missing',
      });
      continue;
    }
    const body = readFileSync(path, 'utf8');
    const used = templateVariables(body);
    for (const name of used) {
      if (!allowed.includes(name)) {
        errors.push({
          file,
          field: 'template',
          message: `unknown variable {{${name}}}`,
        });
      }
    }
    for (const name of allowed) {
      if (!used.includes(name)) {
        errors.push({
          file,
          field: 'template',
          message: `declared variable {{${name}}} is not used`,
        });
      }
    }
    templates.set(id, { id, body, path });
  }

  return { templates, errors };
};
