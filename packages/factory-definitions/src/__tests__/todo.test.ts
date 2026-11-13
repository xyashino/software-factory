import { describe, expect, it } from 'vitest';
import {
  orderIdSchema,
  projectIdSchema,
  type OrderId,
} from '@repo/factory-core/ids';
import {
  dependencyState,
  waitingOn,
  type DependencyView,
} from '../todo-dependencies';
import { scanTodos } from '../todo-scan';
import { parseTodo, type TodoSource } from '../todo';

const PROJECT = projectIdSchema.parse('software-factory');
const LINES = new Set(['feature', 'fast', 'standard']);
const order = (todoId: string): OrderId =>
  orderIdSchema.parse(`software-factory:${todoId}`);

/** A todo file with the given status and extra frontmatter lines. */
const todo = (name: string, status = 'todo', extra = ''): TodoSource => ({
  file: `todos/${name}.md`,
  text: `---\nstatus: ${status}\n${extra}---\n\n# ${name}\n\nBody of ${name}.\n`,
});

const scan = (files: TodoSource[], known: OrderId[] = []) =>
  scanTodos(PROJECT, files, LINES, new Set(known));

const viewOf = (
  files: TodoSource[],
  delivered: OrderId[] = [],
): DependencyView => ({
  fileStates: scan(files).fileStates,
  delivered: new Set(delivered),
});

describe('parseTodo', () => {
  it('reads the defaults: priority medium, no dependencies, the feature line', () => {
    const parsed = parseTodo(PROJECT, 'todos/plain.md', todo('plain').text);
    expect(parsed.ok && parsed.value.todo).toMatchObject({
      file: 'todos/plain.md',
      orderId: 'software-factory:plain',
      todoId: 'plain',
      status: 'todo',
      priority: 'medium',
      dependsOn: [],
      line: 'feature',
    });
  });

  it('keeps the body after the frontmatter', () => {
    const parsed = parseTodo(PROJECT, 'todos/plain.md', todo('plain').text);
    expect(parsed.ok && parsed.value.todo.body).toContain('Body of plain.');
  });

  it('maps depends_on to OrderIds of the same project', () => {
    const parsed = parseTodo(
      PROJECT,
      'todos/second.md',
      todo('second', 'todo', 'depends_on: [first]\n').text,
    );
    expect(parsed.ok && parsed.value.todo.dependsOn).toEqual([order('first')]);
  });

  it('reads the line from line, or from its alias workflow', () => {
    const alias = parseTodo(
      PROJECT,
      'todos/a.md',
      todo('a', 'todo', 'workflow: standard\n').text,
    );
    expect(alias.ok && alias.value.todo.line).toBe('standard');
    const both = parseTodo(
      PROJECT,
      'todos/b.md',
      todo('b', 'todo', 'line: fast\nworkflow: fast\n').text,
    );
    expect(both.ok && both.value.diagnostics).toEqual([]);
  });

  it('reports line and workflow that differ as a line_conflict', () => {
    const parsed = parseTodo(
      PROJECT,
      'todos/c.md',
      todo('c', 'todo', 'line: fast\nworkflow: standard\n').text,
    );
    expect(parsed.ok && parsed.value.diagnostics).toEqual([
      expect.objectContaining({
        file: 'todos/c.md',
        kind: 'line_conflict',
        field: 'line',
      }),
    ]);
  });

  it('reads factory: v2 and leaves it unset otherwise', () => {
    const marked = parseTodo(
      PROJECT,
      'todos/d.md',
      todo('d', 'todo', 'factory: v2\n').text,
    );
    expect(marked.ok && marked.value.todo.factory).toBe('v2');
    const plain = parseTodo(PROJECT, 'todos/e.md', todo('e').text);
    expect(plain.ok && plain.value.todo.factory).toBeUndefined();
  });

  it.each([
    ['no frontmatter', 'todos/x.md', 'no frontmatter here\n', 'frontmatter'],
    ['bad YAML', 'todos/x.md', '---\nstatus: [todo\n---\n', 'yaml'],
    [
      'bad priority',
      'todos/x.md',
      '---\nstatus: todo\npriority: urgent\n---\n',
      'priority',
    ],
    ['bad status', 'todos/x.md', '---\nstatus: review\n---\n', 'status'],
    [
      'bad factory value',
      'todos/x.md',
      '---\nstatus: todo\nfactory: v9\n---\n',
      'factory',
    ],
    [
      'bad dependency id',
      'todos/x.md',
      '---\nstatus: todo\ndepends_on: [Bad_Id]\n---\n',
      'depends_on[0]',
    ],
    ['bad file name', 'todos/Bad_Id.md', '---\nstatus: todo\n---\n', 'file'],
  ])(
    'reports %s as unparseable, with the file and field',
    (_name, file, text, field) => {
      const parsed = parseTodo(PROJECT, file, text);
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.error).toContainEqual(
        expect.objectContaining({ file, kind: 'unparseable', field }),
      );
    },
  );
});

describe('scanTodos', () => {
  it('keeps runnable todos and reports the rest, each with its file', () => {
    const result = scan([
      todo('ok'),
      todo('odd', 'todo', 'line: nope\n'),
      { file: 'todos/broken.md', text: 'no frontmatter\n' },
    ]);
    expect(result.todos.map((item) => item.todoId)).toEqual(['ok']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        file: 'todos/odd.md',
        kind: 'unknown_line',
        field: 'line',
      }),
      expect.objectContaining({
        file: 'todos/broken.md',
        kind: 'unparseable',
        field: 'frontmatter',
      }),
    ]);
  });

  it('reports a todo whose OrderId already exists as reused_id, not a second order', () => {
    const result = scan([todo('again')], [order('again')]);
    expect(result.todos).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ file: 'todos/again.md', kind: 'reused_id' }),
    ]);
  });

  it('gives an unparseable file the state unparseable, keyed by its OrderId', () => {
    const result = scan([
      { file: 'todos/broken.md', text: 'no frontmatter\n' },
    ]);
    expect(result.fileStates.get(order('broken'))).toBe('unparseable');
  });

  it('gives a todo with a diagnostic its status in fileStates, so it still counts for dependencies', () => {
    const result = scan([todo('odd', 'done', 'line: nope\n')]);
    expect(result.fileStates.get(order('odd'))).toBe('done');
  });
});

describe('the missing-dependency rule', () => {
  it('treats a dependency with no todo file as satisfied', () => {
    expect(dependencyState(order('prerequisite'), viewOf([]))).toBe(
      'satisfied',
    );
  });

  it('blocks on an existing dependency with status todo', () => {
    const view = viewOf([todo('prerequisite')]);
    expect(dependencyState(order('prerequisite'), view)).toBe('waiting');
  });

  it('treats a dependency marked done in its file as satisfied', () => {
    const view = viewOf([todo('first', 'done')]);
    expect(dependencyState(order('first'), view)).toBe('satisfied');
  });

  it('keeps a cancelled dependency waiting: only done or delivered unblocks', () => {
    const view = viewOf([todo('first', 'cancelled')]);
    expect(dependencyState(order('first'), view)).toBe('waiting');
  });

  it('counts a delivered dependency as done after its todo file is removed', () => {
    const view = viewOf([], [order('first')]);
    expect(dependencyState(order('first'), view)).toBe('satisfied');
  });

  it('counts a delivered dependency as done even while its file still says todo', () => {
    const view = viewOf([todo('first')], [order('first')]);
    expect(dependencyState(order('first'), view)).toBe('satisfied');
  });

  it('blocks on an existing dependency file that cannot be parsed', () => {
    const view = viewOf([
      { file: 'todos/prerequisite.md', text: 'no frontmatter\n' },
    ]);
    expect(dependencyState(order('prerequisite'), view)).toBe('waiting');
  });

  it('keeps an unparseable dependency waiting even when its order is delivered', () => {
    const view = viewOf(
      [{ file: 'todos/prerequisite.md', text: 'no frontmatter\n' }],
      [order('prerequisite')],
    );
    expect(dependencyState(order('prerequisite'), view)).toBe('waiting');
  });

  it('lists the waiting dependencies in declared order', () => {
    const view = viewOf([todo('a'), todo('b', 'done'), todo('c')]);
    expect(
      waitingOn([order('a'), order('b'), order('c'), order('gone')], view),
    ).toEqual([order('a'), order('c')]);
  });
});
