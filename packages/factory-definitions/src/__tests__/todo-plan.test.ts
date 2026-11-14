import { describe, expect, it } from 'vitest';
import { planSlugSchema, projectIdSchema } from '@repo/factory-core/ids';
import { parseTodo, type TodoSource } from '../todo';
import { scanTodos } from '../todo-scan';
import { validatePlans } from '../todo-plan';

const PROJECT = projectIdSchema.parse('software-factory');
const XYZ = planSlugSchema.parse('xyz');
const ABC = planSlugSchema.parse('abc');
const LINES = new Set(['feature']);

/** A todo file with a plan, optional dependencies and status. */
const planned = (
  name: string,
  plan: string | null,
  deps: string[] = [],
  status = 'todo',
): TodoSource => ({
  file: `todos/${name}.md`,
  text: [
    '---',
    `status: ${status}`,
    ...(plan === null ? [] : [`plan: ${plan}`]),
    ...(deps.length === 0 ? [] : [`depends_on: [${deps.join(', ')}]`]),
    '---',
    '',
    `# ${name}`,
    '',
  ].join('\n'),
});

const chain = (names: string[], plan = 'xyz'): TodoSource[] =>
  names.map((name, index) =>
    planned(name, plan, index === 0 ? [] : [names[index - 1] as string]),
  );

const scan = (files: TodoSource[]) => scanTodos(PROJECT, files, LINES);

describe('plan frontmatter', () => {
  const parsePlan = (plan: string) => {
    const parsed = parseTodo(
      PROJECT,
      'todos/wo-1.md',
      planned('wo-1', plan).text,
    );
    return parsed.ok ? parsed.value.todo.plan : parsed.error;
  };

  it('reads a valid slug onto the todo', () => {
    expect(parsePlan('xyz')).toBe('xyz');
    expect(parsePlan('a'.repeat(64))).toBe('a'.repeat(64));
  });

  it('rejects an empty, uppercase or over-long slug', () => {
    expect(parsePlan('')).toEqual(expect.any(Array));
    expect(parsePlan('Xyz')).toEqual(expect.any(Array));
    expect(parsePlan('a'.repeat(65))).toEqual(expect.any(Array));
  });

  it('leaves a plain todo without a plan', () => {
    const parsed = parseTodo(
      PROJECT,
      'todos/wo-1.md',
      planned('wo-1', null).text,
    );
    expect(parsed.ok && parsed.value.todo.plan).toBeUndefined();
  });

  it('refuses a todo file name with a colon as unparseable', () => {
    const scanned = scan([planned('a:b', 'xyz')]);
    expect(scanned.todos).toEqual([]);
    expect(scanned.diagnostics[0]?.kind).toBe('unparseable');
  });
});

describe('validatePlans', () => {
  const todosOf = (files: TodoSource[]) => {
    const parsed = files.map((file) =>
      parseTodo(PROJECT, file.file, file.text),
    );
    return parsed.flatMap((p) => (p.ok ? [p.value.todo] : []));
  };

  it('accepts a linear chain and orders it root first', () => {
    const checks = validatePlans(todosOf(chain(['wo-1', 'wo-2', 'wo-3'])));
    const check = checks.get(XYZ);
    expect(check?.ok && check.chain.map((t) => t.todoId)).toEqual([
      'wo-1',
      'wo-2',
      'wo-3',
    ]);
  });

  it('refuses a branch', () => {
    const files = [
      planned('wo-1', 'xyz'),
      planned('wo-2', 'xyz', ['wo-1']),
      planned('wo-3', 'xyz', ['wo-1']),
    ];
    const check = validatePlans(todosOf(files)).get(XYZ);
    expect(check?.ok).toBe(false);
  });

  it('refuses two roots', () => {
    const files = [planned('wo-1', 'xyz'), planned('wo-2', 'xyz')];
    expect(validatePlans(todosOf(files)).get(XYZ)?.ok).toBe(false);
  });

  it('refuses a cycle, which has no root', () => {
    const files = [
      planned('wo-1', 'xyz', ['wo-2']),
      planned('wo-2', 'xyz', ['wo-1']),
    ];
    expect(validatePlans(todosOf(files)).get(XYZ)?.ok).toBe(false);
  });

  it('refuses a self-dependency as a cycle', () => {
    const files = [planned('wo-1', 'xyz', ['wo-1'])];
    expect(validatePlans(todosOf(files)).get(XYZ)?.ok).toBe(false);
  });

  it('refuses a dependency on a todo of another plan', () => {
    const files = [
      planned('wo-1', 'xyz'),
      planned('wo-2', 'xyz', ['wo-1']),
      planned('other-1', 'abc'),
      planned('wo-3', 'xyz', ['other-1']),
    ];
    expect(validatePlans(todosOf(files)).get(XYZ)?.ok).toBe(false);
  });

  it('accepts a dependency on a plain todo outside every plan', () => {
    const files = [planned('plain', null), planned('wo-1', 'xyz', ['plain'])];
    expect(validatePlans(todosOf(files)).get(XYZ)?.ok).toBe(true);
  });

  it('leaves done and cancelled members out of the chain', () => {
    const files = [
      planned('wo-1', 'xyz'),
      planned('wo-2', 'xyz', ['wo-1']),
      planned('wo-x', 'xyz', [], 'done'),
    ];
    const check = validatePlans(todosOf(files)).get(XYZ);
    expect(check?.ok && check.chain.length).toBe(2);
  });
});

describe('scanTodos with plans', () => {
  it('turns a three-todo chain into runnable todos and a plan chain', () => {
    const scanned = scan(chain(['wo-1', 'wo-2', 'wo-3']));
    expect(scanned.diagnostics).toEqual([]);
    expect(scanned.todos.map((t) => t.todoId)).toEqual([
      'wo-1',
      'wo-2',
      'wo-3',
    ]);
    expect(scanned.planChains.get(XYZ)?.map((t) => t.todoId)).toEqual([
      'wo-1',
      'wo-2',
      'wo-3',
    ]);
  });

  it('gives every todo of an invalid plan plan_invalid and no runnable todo', () => {
    const files = [
      planned('wo-1', 'xyz'),
      planned('wo-2', 'xyz', ['wo-1']),
      planned('wo-3', 'xyz', ['wo-1']),
      planned('plain', null),
    ];
    const scanned = scan(files);
    const invalid = scanned.diagnostics.filter(
      (d) => d.kind === 'plan_invalid',
    );
    expect(invalid.map((d) => d.file).sort()).toEqual([
      'todos/wo-1.md',
      'todos/wo-2.md',
      'todos/wo-3.md',
    ]);
    expect(invalid[0]?.message).toContain('branch');
    expect(scanned.todos.map((t) => t.todoId)).toEqual(['plain']);
    expect(scanned.planChains.size).toBe(0);
  });

  it('keeps a valid plan when a todo outside it is invalid', () => {
    const files = [
      ...chain(['wo-1', 'wo-2']),
      planned('bad', null, ['nope']),
      planned('wo-x', 'abc', ['wo-y']),
      planned('wo-y', 'abc', ['wo-x']),
    ];
    const scanned = scan(files);
    expect(scanned.todos.map((t) => t.todoId)).toEqual(['wo-1', 'wo-2', 'bad']);
    expect(scanned.planChains.get(XYZ)?.length).toBe(2);
    expect(scanned.planChains.has(ABC)).toBe(false);
    expect(
      scanned.diagnostics
        .filter((d) => d.kind === 'plan_invalid')
        .map((d) => d.file),
    ).toEqual(['todos/wo-x.md', 'todos/wo-y.md']);
  });

  it('marks the whole plan invalid when one member is not runnable', () => {
    const files = [
      planned('wo-1', 'xyz'),
      {
        file: 'todos/wo-2.md',
        text: '---\nstatus: todo\nplan: xyz\ndepends_on: [wo-1]\nline: nope\n---\n',
      },
    ];
    const scanned = scan(files);
    expect(scanned.diagnostics.map((d) => d.kind)).toContain('plan_invalid');
    expect(scanned.todos).toEqual([]);
  });
});
