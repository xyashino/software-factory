import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadPrTemplates,
  loadRuntimePrompts,
  loadTemplates,
  RUNTIME_PROMPT_KEYS,
} from '../templates';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const SHIPPED_DIRS = ['templates/prompts', 'templates/pr', 'templates/runtime'];

/**
 * A temp copy of every shipped template, with the given edits applied. A
 * `null` edit deletes the file; a string replaces its text.
 */
const tmpTemplates = (edits: Record<string, string | null>): string => {
  const root = mkdtempSync(join(tmpdir(), 'sf-templates-'));
  for (const dir of SHIPPED_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
    for (const name of readdirSync(join(PACKAGE_ROOT, dir))) {
      const file = `${dir}/${name}`;
      const edit = edits[file];
      if (edit === null) continue;
      const text = edit ?? readFileSync(join(PACKAGE_ROOT, file), 'utf8');
      writeFileSync(join(root, file), text);
    }
  }
  for (const [file, text] of Object.entries(edits)) {
    if (
      text === null ||
      SHIPPED_DIRS.every((dir) => !file.startsWith(`${dir}/`))
    ) {
      continue;
    }
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
};

describe('shipped templates', () => {
  it('ship the five runtime prompts, with their placeholders in place', () => {
    const loaded = loadRuntimePrompts(PACKAGE_ROOT);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('runtime prompts must load');
    expect(Object.keys(loaded.value).sort()).toEqual(
      [...RUNTIME_PROMPT_KEYS].sort(),
    );
    expect(loaded.value.answer).toContain('{{answer}}');
    expect(loaded.value.nudge).toContain('{{text}}');
    expect(loaded.value.handoverRequest.length).toBeGreaterThan(0);
  });

  it('ship eleven supervisor prompts and three PR templates', () => {
    expect(loadTemplates(PACKAGE_ROOT).templates.size).toBe(11);
    expect(loadTemplates(PACKAGE_ROOT).errors).toEqual([]);
    expect(loadPrTemplates(PACKAGE_ROOT).templates.size).toBe(3);
    expect(loadPrTemplates(PACKAGE_ROOT).errors).toEqual([]);
  });
});

describe('runtime prompt checks', () => {
  it('reports a runtime prompt that lost its placeholder, with file and field', () => {
    const root = tmpTemplates({ 'templates/runtime/answer.md': 'Answered.\n' });
    const loaded = loadRuntimePrompts(root);
    expect(!loaded.ok && loaded.error).toContainEqual({
      file: 'templates/runtime/answer.md',
      field: 'template',
      message: 'declared variable {{answer}} is not used',
    });
  });

  it('reports a placeholder no runtime prompt declares, with file and field', () => {
    const root = tmpTemplates({
      'templates/runtime/nudge.md': 'Note: {{text}} by {{who}}\n',
    });
    const loaded = loadRuntimePrompts(root);
    expect(!loaded.ok && loaded.error).toContainEqual({
      file: 'templates/runtime/nudge.md',
      field: 'template',
      message: 'unknown variable {{who}}',
    });
  });

  it('reports a missing runtime prompt file', () => {
    const root = tmpTemplates({
      'templates/runtime/handover-request.md': null,
    });
    const loaded = loadRuntimePrompts(root);
    expect(!loaded.ok && loaded.error).toContainEqual({
      file: 'templates/runtime/handover-request.md',
      field: '(file)',
      message: 'template file is missing',
    });
  });
});

describe('supervisor prompt checks', () => {
  it('reports a placeholder the template does not declare, with file and field', () => {
    const root = tmpTemplates({
      'templates/prompts/nudge-silent.md': 'Wait {{minutes}} {{surprise}}\n',
    });
    const loaded = loadTemplates(root);
    expect(loaded.errors).toContainEqual({
      file: 'templates/prompts/nudge-silent.md',
      field: 'template',
      message: 'unknown variable {{surprise}}',
    });
  });

  it('reports a prompt file that no declared template owns', () => {
    const root = tmpTemplates({ 'templates/prompts/extra.md': 'x\n' });
    const loaded = loadTemplates(root);
    expect(loaded.errors).toContainEqual(
      expect.objectContaining({
        file: 'templates/prompts/extra.md',
        field: '(file)',
      }),
    );
  });
});
