import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectIdSchema } from '@repo/factory-core/ids';
import { describe, expect, it } from 'vitest';
import { check } from '../check';
import { nitpickCatalog } from '../nitpick-catalog';
import { loadDefinitions } from '../load';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');
const PROJECT = projectIdSchema.parse('software-factory');

/** A temp copy of the operators, lines and templates, with the given edits (null deletes). */
const copyPackage = (edits: Record<string, string | null>): string => {
  const root = mkdtempSync(join(tmpdir(), 'sf-package-'));
  for (const dir of [
    'operators',
    'lines',
    'templates/prompts',
    'templates/pr',
    'templates/runtime',
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
    for (const name of readdirSync(join(PACKAGE_ROOT, dir))) {
      const file = `${dir}/${name}`;
      const edit = edits[file];
      if (edit === null) continue;
      writeFileSync(
        join(root, file),
        edit ?? readFileSync(join(PACKAGE_ROOT, file), 'utf8'),
      );
    }
  }
  return root;
};

describe('shipped definitions', () => {
  const loaded = loadDefinitions(PACKAGE_ROOT);

  const definitions = () => {
    if (!loaded.ok)
      throw new Error(
        `shipped definitions are invalid: ${JSON.stringify(loaded.error)}`,
      );
    return loaded.value;
  };

  it('load without errors', () => {
    expect(loaded.ok ? [] : loaded.error).toEqual([]);
  });

  it('ship four operator profiles and no on-call operator (that stays behind until M10)', () => {
    expect([...definitions().operators.keys()].sort()).toEqual([
      'builder',
      'doctor',
      'plan-reviewer',
      'planner',
    ]);
    expect(definitions().operators.has('operator')).toBe(false);
  });

  it('ship three lines, each with schema v2 and no operator block', () => {
    expect([...definitions().lines.keys()].sort()).toEqual([
      'fast',
      'feature',
      'standard',
    ]);
    for (const { line } of definitions().lines.values()) {
      expect(line).not.toHaveProperty('operator');
    }
  });

  it('prepare every line workspace before any station: fetch origin, then install', () => {
    for (const { line } of definitions().lines.values()) {
      expect(line.workspace.sync?.exec).toEqual(['git fetch origin']);
      expect(line.workspace.sync?.timeoutMs).toBe(120_000);
      expect(line.workspace.setup.exec).toEqual([
        'pnpm install --frozen-lockfile',
      ]);
    }
  });

  it('name the builder profile in every line that builds', () => {
    expect(
      definitions().lines.get('feature')?.line.operators['builder']?.profile,
    ).toBe('builder');
    expect(
      definitions().lines.get('fast')?.line.operators['builder']?.profile,
    ).toBe('builder');
  });

  it('keep runner and model out of every profile body', () => {
    for (const profile of definitions().operators.values()) {
      expect(profile.body).not.toMatch(/\brunner\b|\bmodel\b/i);
    }
  });

  it('declare the rules and skills of the builder and the doctor', () => {
    expect(definitions().operators.get('builder')).toMatchObject({
      label: 'Builder',
      rules: ['rich-commit', 'decision-log', 'testing'],
      skills: ['evidence'],
    });
    expect(definitions().operators.get('doctor')?.verdict).toBe(true);
  });

  it('pass check() with no catalog', () => {
    expect(check(PACKAGE_ROOT)).toEqual([]);
  });

  it('pass check() with the .nitpick catalog: every declared rule and skill exists', async () => {
    const catalog = await nitpickCatalog(REPO_ROOT);
    expect(check(PACKAGE_ROOT, { catalog })).toEqual([]);
  });

  it('pass check() with the todo scan of a clean todo', () => {
    const errors = check(PACKAGE_ROOT, {
      todos: {
        projectId: PROJECT,
        files: [
          { file: 'todos/ok.md', text: '---\nstatus: todo\n---\n\n# ok\n' },
        ],
      },
    });
    expect(errors).toEqual([]);
  });

  it('reports a todo that cannot be parsed with its file and field', () => {
    const errors = check(PACKAGE_ROOT, {
      todos: {
        projectId: PROJECT,
        files: [{ file: 'todos/broken.md', text: 'no frontmatter\n' }],
      },
    });
    expect(errors).toEqual([
      {
        file: 'todos/broken.md',
        field: 'frontmatter',
        message: 'missing frontmatter: the file must start with a --- block',
      },
    ]);
  });

  it('reports a broken shipped line with its file and field from check()', () => {
    const root = copyPackage({
      'lines/feature.yml': readFileSync(
        join(PACKAGE_ROOT, 'lines', 'feature.yml'),
        'utf8',
      ).replace('max: 3', 'max: 9'),
    });
    expect(check(root)).toContainEqual(
      expect.objectContaining({
        file: 'lines/feature.yml',
        field: 'stations[3].onFail.max',
      }),
    );
  });
});
