import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { findDependencyCycle } from '../apps/hq/src/domain/queue/dag';
import {
  parseTodoMarkdown,
  type TodoFile,
} from '../apps/hq/src/domain/queue/todo-markdown';

const TODO_DIRS = ['orders', 'todos'];
const LINES_DIR = '.factory/lines';
const TODO_EXTENSION = '.md';

type LintError = { file: string; message: string };

type ParsedTodo = { file: string; todo: TodoFile };

const listTodoFiles = (root: string, dir: string): string[] => {
  const path = join(root, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith(TODO_EXTENSION))
    .sort()
    .map((name) => `${dir}/${name}`);
};

const lineErrors = (root: string, { file, todo }: ParsedTodo): LintError[] =>
  existsSync(join(root, LINES_DIR, `${todo.line}.yml`))
    ? []
    : [
        {
          file,
          message: `line ${todo.line} has no ${LINES_DIR}/${todo.line}.yml`,
        },
      ];

const parentErrors = (
  known: ReadonlySet<string>,
  { file, todo }: ParsedTodo,
): LintError[] => {
  const parent = todo.dependsOn;
  if (parent === null || known.has(parent)) return [];
  return [
    {
      file,
      message: `depends_on ${parent} is not a todo in orders/ or todos/`,
    },
  ];
};

const cycleErrors = (parsed: readonly ParsedTodo[]): LintError[] => {
  const parentOf = new Map(
    parsed.map(({ todo }) => [todo.slug, todo.dependsOn] as const),
  );
  const fileOf = new Map(parsed.map(({ file, todo }) => [todo.slug, file]));
  const cycle = findDependencyCycle(parentOf);
  return cycle === null
    ? []
    : [
        {
          file: fileOf.get(cycle) ?? cycle,
          message: 'depends_on forms a cycle',
        },
      ];
};

const lintRoot = (root: string): LintError[] => {
  const files = TODO_DIRS.flatMap((dir) => listTodoFiles(root, dir));
  const known = new Set(files.map((file) => basename(file, TODO_EXTENSION)));
  const parseErrors: LintError[] = [];
  const parsed: ParsedTodo[] = [];
  for (const file of files) {
    const result = parseTodoMarkdown(
      basename(file),
      readFileSync(join(root, file), 'utf8'),
    );
    if (result.ok) parsed.push({ file, todo: result.todo });
    else parseErrors.push({ file, message: result.error });
  }
  return [
    ...parseErrors,
    ...parsed.flatMap((item) => [
      ...lineErrors(root, item),
      ...parentErrors(known, item),
    ]),
    ...cycleErrors(parsed),
  ];
};

const main = (): void => {
  const root = resolve(process.argv[2] ?? process.cwd());
  const errors = lintRoot(root);
  for (const { file, message } of errors) console.error(`${file}: ${message}`);
  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log('todo:lint ok');
};

main();
