import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { err, ok, type Result } from '@repo/factory-core/result';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import type { DefinitionError } from './errors';
import { listFiles } from './files';
import { parseLine, type Line } from './line-schema';
import { validateLine } from './line-validate';
import { toLineSnapshot } from './line-snapshot';
import type { NitpickCatalog } from './nitpick-catalog';
import { validateOperatorCatalog } from './operator-catalog';
import { parseOperatorProfile, type OperatorProfile } from './operator-profile';
import {
  loadPrTemplates,
  loadRuntimePrompts,
  loadTemplates,
  type RuntimePrompts,
  type Template,
} from './templates';

/** A Line with its normalised snapshot, ready to be pinned on a Work order. */
export interface LoadedLine {
  line: Line;
  snapshot: LineSnapshot;
}

/** Every definition under the package root, validated. */
export interface Definitions {
  /** operator profiles, keyed by profile id */
  operators: Map<string, OperatorProfile>;
  /** Lines, keyed by name */
  lines: Map<string, LoadedLine>;
  /** supervisor prompt templates, keyed by id */
  templates: Map<string, Template>;
  /** PR markdown templates, keyed by id */
  prTemplates: Map<string, Template>;
  /** the five runtime prompt texts, placeholders in place */
  runtimePrompts: RuntimePrompts;
}

/** Definitions as far as they loaded, with every problem found along the way. */
export interface ReadResult {
  definitions: Definitions;
  errors: DefinitionError[];
}

const EMPTY_RUNTIME_PROMPTS: RuntimePrompts = {
  answer: '',
  nudge: '',
  idleReminder: '',
  silentReminder: '',
  handoverRequest: '',
};

const readText = (root: string, file: string): string =>
  readFileSync(join(root, file), 'utf8');

/**
 * Reads and validates every operator profile, Line, template and runtime
 * prompt under `packageRoot`. Nothing is bundled: files are read on each
 * call. Every problem is collected, not just the first. With `catalog` (from
 * `.nitpick`), declared rules and skills must exist there.
 */
export const readDefinitions = (
  packageRoot: string,
  catalog?: NitpickCatalog,
): ReadResult => {
  const errors: DefinitionError[] = [];
  const operators = new Map<string, OperatorProfile>();
  const lines = new Map<string, LoadedLine>();

  const operatorFiles = listFiles(packageRoot, 'operators', '.md');
  if (operatorFiles === null) {
    errors.push({
      file: 'operators',
      field: '(directory)',
      message: 'directory not found',
    });
  }
  const brokenOperators = new Set<string>();
  for (const file of operatorFiles ?? []) {
    const parsed = parseOperatorProfile(
      { file, path: join(packageRoot, file) },
      readText(packageRoot, file),
    );
    if (!parsed.ok) {
      brokenOperators.add(basename(file, '.md'));
      errors.push(...parsed.error);
      continue;
    }
    operators.set(parsed.value.id, parsed.value);
    if (catalog !== undefined) {
      errors.push(...validateOperatorCatalog(file, parsed.value, catalog));
    }
  }

  const lineFiles = listFiles(packageRoot, 'lines', '.yml');
  if (lineFiles === null) {
    errors.push({
      file: 'lines',
      field: '(directory)',
      message: 'directory not found',
    });
  }
  for (const file of lineFiles ?? []) {
    const parsed = parseLine(
      { file, path: join(packageRoot, file) },
      readText(packageRoot, file),
    );
    if (!parsed.ok) {
      errors.push(...parsed.error);
      continue;
    }
    const line = parsed.value;
    const problems = validateLine(file, line, operators, brokenOperators);
    if (problems.length > 0) {
      errors.push(...problems);
      continue;
    }
    const snapshot = toLineSnapshot(file, line, operators);
    if (!snapshot.ok) {
      errors.push(...snapshot.error);
      continue;
    }
    lines.set(line.name, { line, snapshot: snapshot.value });
  }

  const templates = loadTemplates(packageRoot);
  const prTemplates = loadPrTemplates(packageRoot);
  const runtime = loadRuntimePrompts(packageRoot);
  errors.push(...templates.errors, ...prTemplates.errors);
  if (!runtime.ok) {
    errors.push(...runtime.error);
  }

  return {
    definitions: {
      operators,
      lines,
      templates: templates.templates,
      prTemplates: prTemplates.templates,
      runtimePrompts: runtime.ok ? runtime.value : EMPTY_RUNTIME_PROMPTS,
    },
    errors,
  };
};

/**
 * Loads every definition under `packageRoot` or returns all problems at once,
 * each with its file and field.
 */
export const loadDefinitions = (
  packageRoot: string,
  catalog?: NitpickCatalog,
): Result<Definitions, DefinitionError[]> => {
  const read = readDefinitions(packageRoot, catalog);
  return read.errors.length > 0 ? err(read.errors) : ok(read.definitions);
};
