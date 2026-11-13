import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DefinitionError } from './errors';
import { listFiles } from './files';
import { err, ok, type Result } from '@repo/factory-core/result';

const PLACEHOLDER = /\{\{([a-zA-Z0-9_]+)\}\}/g;
const PROMPT_DIR = 'templates/prompts';
const PR_DIR = 'templates/pr';
const RUNTIME_DIR = 'templates/runtime';

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

/**
 * The runtime prompts a Job carries (PROTOCOL §4). Each key names its file
 * under `templates/runtime/` and the placeholders it must contain. The
 * runtime renders them; this package only checks and loads the text.
 */
export const RUNTIME_PROMPT_VARS = {
  answer: { file: 'answer', vars: ['answer'] },
  nudge: { file: 'nudge', vars: ['text'] },
  idleReminder: {
    file: 'idle-reminder',
    vars: ['count', 'limit', 'missing'],
  },
  silentReminder: { file: 'silent-reminder', vars: ['minutes'] },
  handoverRequest: { file: 'handover-request', vars: [] },
} as const satisfies Record<string, { file: string; vars: readonly string[] }>;

export type RuntimePromptKey = keyof typeof RUNTIME_PROMPT_VARS;

export const RUNTIME_PROMPT_KEYS = Object.keys(
  RUNTIME_PROMPT_VARS,
) as RuntimePromptKey[];

/** The five runtime prompt texts, with their placeholders still in place. */
export type RuntimePrompts = Record<RuntimePromptKey, string>;

/** A template file: its id, body and absolute path. */
export interface Template {
  id: string;
  body: string;
  /** absolute path of the template file */
  path: string;
}

export interface LoadedTemplates {
  templates: Map<string, Template>;
  errors: DefinitionError[];
}

interface Slot {
  id: string;
  /** path relative to the package root */
  file: string;
  vars: readonly string[];
}

/**
 * The distinct placeholder names in a template, in order of first appearance.
 * Only the scanner: rendering is done by the runtime (v2-09).
 */
export const templateVariables = (template: string): string[] => {
  const names = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match[1] !== undefined) {
      names.add(match[1]);
    }
  }
  return [...names];
};

/** Reads every supervisor prompt template and checks its variables against TEMPLATE_VARS. */
export const loadTemplates = (packageRoot: string): LoadedTemplates => {
  const slots = Object.entries(TEMPLATE_VARS).map(([id, vars]) => ({
    id,
    file: `${PROMPT_DIR}/${id}.md`,
    vars,
  }));
  return readSlots(packageRoot, PROMPT_DIR, slots, 'TEMPLATE_VARS');
};

/** Reads every PR markdown template and checks its variables against PR_TEMPLATE_VARS. */
export const loadPrTemplates = (packageRoot: string): LoadedTemplates => {
  const slots = Object.entries(PR_TEMPLATE_VARS).map(([id, vars]) => ({
    id,
    file: `${PR_DIR}/${id}.md`,
    vars,
  }));
  return readSlots(packageRoot, PR_DIR, slots, 'PR_TEMPLATE_VARS');
};

/**
 * Reads the five runtime prompts from `templates/runtime/`. Each must exist,
 * contain its required placeholders and use no other placeholder. Every
 * problem is collected, never just the first.
 */
export const loadRuntimePrompts = (
  packageRoot: string,
): Result<RuntimePrompts, DefinitionError[]> => {
  const slots = RUNTIME_PROMPT_KEYS.map((key) => ({
    id: key,
    file: `${RUNTIME_DIR}/${RUNTIME_PROMPT_VARS[key].file}.md`,
    vars: RUNTIME_PROMPT_VARS[key].vars,
  }));
  const loaded = readSlots(
    packageRoot,
    RUNTIME_DIR,
    slots,
    'RUNTIME_PROMPT_VARS',
  );
  if (loaded.errors.length > 0) {
    return err(loaded.errors);
  }
  const bodies = Object.fromEntries(
    RUNTIME_PROMPT_KEYS.map((key) => [
      key,
      loaded.templates.get(key)?.body ?? '',
    ]),
  ) as RuntimePrompts;
  return ok(bodies);
};

/**
 * Every placeholder must be declared, and every declared variable must be used
 * (a runtime prompt without its placeholder is reported here).
 */
const checkVariables = (
  file: string,
  body: string,
  allowed: readonly string[],
): DefinitionError[] => {
  const errors: DefinitionError[] = [];
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
  return errors;
};

/**
 * Reads each slot's file in `dir` and checks it: every file must belong to a
 * slot, every slot must have a file, and every placeholder must be declared.
 * Declared variables a template does not use are reported too.
 */
const readSlots = (
  packageRoot: string,
  dir: string,
  slots: readonly Slot[],
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

  const known = new Set(slots.map((slot) => slot.file));
  for (const file of files) {
    if (!known.has(file)) {
      errors.push({
        file,
        field: '(file)',
        message: `"${basename(file, '.md')}" is not a known template; add it to ${varsName} in src/templates.ts`,
      });
    }
  }

  for (const slot of slots) {
    const path = join(packageRoot, slot.file);
    if (!existsSync(path)) {
      errors.push({
        file: slot.file,
        field: '(file)',
        message: 'template file is missing',
      });
      continue;
    }
    const body = readFileSync(path, 'utf8');
    errors.push(...checkVariables(slot.file, body, slot.vars));
    templates.set(slot.id, { id: slot.id, body, path });
  }

  return { templates, errors };
};
