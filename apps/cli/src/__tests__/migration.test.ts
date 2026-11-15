import { describe, expect, it } from 'vitest';
import {
  orderIdOf,
  planSlugSchema,
  projectIdSchema,
  todoIdSchema,
  type OrderId,
  type ProjectId,
} from '@repo/factory-core/ids';
import type { TodoSource } from '@repo/factory-definitions/todo';
import { planMigration, type MigrationInput } from '../commands/migration';

const PROJECT: ProjectId = projectIdSchema.parse('demo');
const LINES = new Set(['feature']);
const order = (todoId: string): OrderId =>
  orderIdOf(PROJECT, todoIdSchema.parse(todoId));

/** A v2 todo file with the given status and extra frontmatter lines. */
const todo = (name: string, extra = '', status = 'todo'): TodoSource => {
  // A test's own `line:` replaces the default feature line (a duplicate key would not parse).
  const line = /^line:/m.test(extra) ? '' : 'line: feature\n';
  return {
    file: `todos/${name}.md`,
    text: `---\nstatus: ${status}\nfactory: v2\n${line}${extra}---\n\n# ${name}: Title of ${name}\n\nBody of ${name}.\n`,
  };
};

const input = (
  sources: TodoSource[],
  overrides: Partial<MigrationInput> = {},
): MigrationInput => ({
  projectId: PROJECT,
  sources,
  lines: LINES,
  existingOrderIds: new Set(),
  existingPlanSlugs: new Set(),
  all: false,
  ...overrides,
});

const outcomeOf = (
  result: ReturnType<typeof planMigration>,
  file: string,
): string | undefined =>
  result.items.find((item) => item.file === file)?.outcome;

describe('planMigration: what is created', () => {
  it('creates a plain todo as a standalone order with its title and type', () => {
    const result = planMigration(input([todo('alpha')]));

    expect(result.diagnostics).toEqual([]);
    expect(result.orders.map((unit) => unit.todo.todoId)).toEqual(['alpha']);
    expect(result.orders[0]?.todo).toMatchObject({
      title: 'Title of alpha',
      type: 'feat',
    });
    expect(outcomeOf(result, 'todos/alpha.md')).toBe('would-create');
  });

  it('orders a standalone dependency before the todo that waits on it', () => {
    const result = planMigration(
      input([todo('b', 'depends_on: [a]\n'), todo('a')]),
    );

    expect(result.orders.map((unit) => unit.todo.todoId)).toEqual(['a', 'b']);
    expect(result.orders[1]?.dependsOn).toEqual([order('a')]);
  });

  it('creates a chain as a plan, members in chain order, root first', () => {
    const result = planMigration(
      input([
        todo('two', 'plan: pl\ndepends_on: [one]\n'),
        todo('one', 'plan: pl\n'),
        todo('three', 'plan: pl\ndepends_on: [two]\n'),
      ]),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.slug).toBe('pl');
    expect(result.plans[0]?.members.map((m) => m.todoId)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(result.orders).toEqual([]);
  });

  it('marks a todo without a type line as the default feat in its item', () => {
    const result = planMigration(input([todo('alpha')]));
    expect(result.items[0]?.reason).toContain('type=feat (default)');
  });

  it('names an explicit type without the default note', () => {
    const result = planMigration(input([todo('alpha', 'type: fix\n')]));
    expect(result.orders[0]?.todo.type).toBe('fix');
    expect(result.items[0]?.reason).toContain('type=fix');
    expect(result.items[0]?.reason).not.toContain('(default)');
  });
});

describe('planMigration: what is skipped', () => {
  it('skips a file whose order the server has, before the scan (no reused_id)', () => {
    const result = planMigration(
      input([todo('alpha')], { existingOrderIds: new Set([order('alpha')]) }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.orders).toEqual([]);
    expect(result.items[0]).toMatchObject({
      outcome: 'skipped',
      onServer: true,
    });
  });

  it('skips every file of a plan the server already has', () => {
    const result = planMigration(
      input(
        [
          todo('one', 'plan: pl\n'),
          todo('two', 'plan: pl\ndepends_on: [one]\n'),
        ],
        { existingPlanSlugs: new Set([planSlugSchema.parse('pl')]) },
      ),
    );

    expect(result.plans).toEqual([]);
    expect(result.items.map((i) => i.outcome)).toEqual(['skipped', 'skipped']);
    expect(result.items.every((i) => i.onServer)).toBe(true);
  });

  it('skips done and cancelled todos: they are not created', () => {
    const result = planMigration(
      input([todo('done-one', '', 'done'), todo('gone', '', 'cancelled')]),
    );

    expect(result.orders).toEqual([]);
    expect(result.items.map((i) => i.outcome)).toEqual(['skipped', 'skipped']);
    expect(result.items[0]?.reason).toContain('done, not migrated');
  });

  it('leaves a todo without factory: v2 out unless --all', () => {
    const v1: TodoSource = {
      file: 'todos/v1.md',
      text: '---\nstatus: todo\nline: feature\n---\n\n# v1: One\n\nx\n',
    };
    const off = planMigration(input([v1]));
    expect(off.orders).toEqual([]);
    expect(outcomeOf(off, 'todos/v1.md')).toBe('skipped');

    const on = planMigration(input([v1], { all: true }));
    expect(on.orders.map((u) => u.todo.todoId)).toEqual(['v1']);
  });

  it('sends a dependency the server has in dependsOn, and does not wait for it', () => {
    const result = planMigration(
      input([todo('b', 'depends_on: [a]\n')], {
        existingOrderIds: new Set([order('a')]),
      }),
    );

    expect(result.orders[0]?.dependsOn).toEqual([order('a')]);
  });

  it('treats a dependency whose file is done as satisfied: nothing sent', () => {
    const result = planMigration(
      input([todo('b', 'depends_on: [a]\n'), todo('a', '', 'done')]),
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.orders.map((u) => u.todo.todoId)).toEqual(['b']);
    expect(result.orders[0]?.dependsOn).toEqual([]);
  });

  it('treats a dependency with no file as satisfied', () => {
    const result = planMigration(input([todo('b', 'depends_on: [gone]\n')]));

    expect(result.orders[0]?.dependsOn).toEqual([]);
  });
});

describe('planMigration: what is blocked', () => {
  it('blocks a todo that depends on a todo it does not migrate, and says why', () => {
    const result = planMigration(
      input([todo('b', 'depends_on: [a]\n'), todo('a', 'line: nope\n')]),
    );

    expect(result.diagnostics.map((d) => d.kind)).toContain('unknown_line');
    expect(result.orders).toEqual([]);
    expect(outcomeOf(result, 'todos/b.md')).toBe('error');
    expect(result.items.find((i) => i.file === 'todos/b.md')?.reason).toContain(
      'not migrated',
    );
  });

  it('blocks a dependent of a blocked todo, all the way down', () => {
    const result = planMigration(
      input([
        todo('c', 'depends_on: [b]\n'),
        todo('b', 'depends_on: [a]\n'),
        todo('a', 'line: nope\n'),
      ]),
    );

    expect(result.orders).toEqual([]);
    expect(outcomeOf(result, 'todos/c.md')).toBe('error');
  });

  it('blocks a standalone dependency cycle', () => {
    const result = planMigration(
      input([todo('a', 'depends_on: [b]\n'), todo('b', 'depends_on: [a]\n')]),
    );

    expect(result.orders).toEqual([]);
    expect(result.items.map((i) => i.outcome)).toEqual(['error', 'error']);
    expect(result.items[0]?.reason).toContain('cycle');
  });

  it('blocks a plan whose member depends on a todo outside the plan', () => {
    const result = planMigration(
      input([
        todo('one', 'plan: pl\ndepends_on: [outside]\n'),
        todo('outside'),
      ]),
    );

    expect(result.plans).toEqual([]);
    expect(outcomeOf(result, 'todos/one.md')).toBe('error');
    expect(
      result.items.find((i) => i.file === 'todos/one.md')?.reason,
    ).toContain('cannot express');
  });

  it('blocks a plan member whose line is unknown, and the plan with it', () => {
    const result = planMigration(
      input([
        todo('one', 'plan: pl\n'),
        todo('two', 'plan: pl\ndepends_on: [one]\nline: nope\n'),
      ]),
    );

    expect(result.plans).toEqual([]);
    expect(result.diagnostics.map((d) => d.kind)).toContain('unknown_line');
    expect(outcomeOf(result, 'todos/two.md')).toBe('error');
  });

  it('refuses a plan with a branch: a diagnostic, nothing created for it', () => {
    const result = planMigration(
      input([
        todo('root', 'plan: pl\n'),
        todo('left', 'plan: pl\ndepends_on: [root]\n'),
        todo('right', 'plan: pl\ndepends_on: [root]\n'),
      ]),
    );

    expect(result.plans).toEqual([]);
    expect(result.items.every((i) => i.outcome === 'error')).toBe(true);
  });
});
