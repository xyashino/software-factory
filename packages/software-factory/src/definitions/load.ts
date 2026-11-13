import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadPrTemplates, loadTemplates } from '../prompts/templates';
import type { DefinitionError } from './errors';
import { listFiles } from './files';
import type { NitpickCatalog } from './nitpick-catalog';
import { parseRole } from './role';
import { parseWorkflow } from './workflow';
import {
  validateRoleCatalog,
  validateWorkflow,
  type LoadedWorkflow,
} from './validate';
import type { Definitions, Result, Role, Workflow } from './types';

/**
 * Reads and validates every role, workflow and template under `packageRoot`.
 * Nothing is bundled: files are read from disk on each call. All problems are
 * collected, never just the first. With `catalog` (from `.nitpick`), declared
 * rules and skills must exist there; without it that check is skipped.
 */
export const loadDefinitions = (
  packageRoot: string,
  catalog?: NitpickCatalog,
): Result<Definitions, DefinitionError[]> => {
  const errors: DefinitionError[] = [];

  const roles = new Map<string, Role>();
  /** ids of role files that failed to parse; references to them are not reported twice */
  const brokenRoles = new Set<string>();
  const roleFiles = listFiles(packageRoot, 'roles', '.md');
  if (roleFiles === null) {
    errors.push({
      file: 'roles',
      field: '(directory)',
      message: 'directory not found',
    });
  }
  for (const file of roleFiles ?? []) {
    const parsed = parseRole(
      { file, path: join(packageRoot, file) },
      readFileSync(join(packageRoot, file), 'utf8'),
    );
    if (parsed.ok) {
      roles.set(parsed.value.id, parsed.value);
      if (catalog !== undefined) {
        errors.push(...validateRoleCatalog(file, parsed.value, catalog));
      }
    } else {
      brokenRoles.add(basename(file, '.md'));
      errors.push(...parsed.error);
    }
  }

  const workflows = new Map<string, Workflow>();
  const loadedWorkflows: LoadedWorkflow[] = [];
  const workflowFiles = listFiles(packageRoot, 'workflows', '.yml');
  if (workflowFiles === null) {
    errors.push({
      file: 'workflows',
      field: '(directory)',
      message: 'directory not found',
    });
  }
  for (const file of workflowFiles ?? []) {
    const parsed = parseWorkflow(
      { file, path: join(packageRoot, file) },
      readFileSync(join(packageRoot, file), 'utf8'),
    );
    if (parsed.ok) {
      loadedWorkflows.push({ file, workflow: parsed.value });
    } else {
      errors.push(...parsed.error);
    }
  }
  for (const { file, workflow } of loadedWorkflows) {
    errors.push(...validateWorkflow(file, workflow, roles, brokenRoles));
    workflows.set(workflow.name, workflow);
  }

  const templates = loadTemplates(packageRoot);
  errors.push(...templates.errors);
  const prTemplates = loadPrTemplates(packageRoot);
  errors.push(...prTemplates.errors);

  if (errors.length > 0) {
    return { ok: false, error: errors };
  }
  return {
    ok: true,
    value: {
      roles,
      workflows,
      templates: templates.templates,
      prTemplates: prTemplates.templates,
    },
  };
};
