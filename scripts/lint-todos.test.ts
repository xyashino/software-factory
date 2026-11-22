import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const LINE_FILES = { '.factory/lines/standard.yml': 'name: standard\n' };

const createdRoots: string[] = [];

const todoFile = (slug: string, frontmatter: string[]): string =>
  ['---', ...frontmatter, '---', '', `# ${slug}: Do the thing`, ''].join('\n');

const makeRepo = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'todo-lint-'));
  createdRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
};

const runLint = async (root: string) => {
  const proc = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'lint-todos.ts'), root],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
};

afterEach(() => {
  for (const root of createdRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe('todo lint', () => {
  it('passes when every todo follows the importer rules', async () => {
    const root = makeRepo({
      ...LINE_FILES,
      'todos/parent.md': todoFile('parent', ['line: standard']),
      'todos/child.md': todoFile('child', [
        'line: standard',
        'depends_on: parent',
      ]),
    });

    const { exitCode, output } = await runLint(root);

    expect(exitCode).toBe(0);
    expect(output).toContain('todo:lint ok');
  });

  it('fails when a todo names two parents', async () => {
    const root = makeRepo({
      ...LINE_FILES,
      'todos/a.md': todoFile('a', ['line: standard']),
      'todos/b.md': todoFile('b', ['line: standard']),
      'todos/child.md': todoFile('child', [
        'line: standard',
        'depends_on: [a, b]',
      ]),
    });

    const { exitCode, output } = await runLint(root);

    expect(exitCode).toBe(1);
    expect(output).toContain(
      'todos/child.md: depends_on allows at most one parent',
    );
  });

  it('fails when the type is not an order type', async () => {
    const root = makeRepo({
      ...LINE_FILES,
      'todos/a.md': todoFile('a', ['line: standard', 'type: epic']),
    });

    const { exitCode, output } = await runLint(root);

    expect(exitCode).toBe(1);
    expect(output).toContain('todos/a.md: type must be one of');
  });

  it('fails when the todo names a line with no line file', async () => {
    const root = makeRepo({
      ...LINE_FILES,
      'todos/a.md': todoFile('a', ['line: ghost']),
    });

    const { exitCode, output } = await runLint(root);

    expect(exitCode).toBe(1);
    expect(output).toContain(
      'todos/a.md: line ghost has no .factory/lines/ghost.yml',
    );
  });

  it('fails when the todo has no line', async () => {
    const root = makeRepo({
      ...LINE_FILES,
      'todos/a.md': todoFile('a', ['type: feat']),
    });

    const { exitCode, output } = await runLint(root);

    expect(exitCode).toBe(1);
    expect(output).toContain('todos/a.md: line is required');
  });

  it('fails when depends_on names a todo that does not exist', async () => {
    const root = makeRepo({
      ...LINE_FILES,
      'todos/child.md': todoFile('child', [
        'line: standard',
        'depends_on: missing',
      ]),
    });

    const { exitCode, output } = await runLint(root);

    expect(exitCode).toBe(1);
    expect(output).toContain(
      'todos/child.md: depends_on missing is not a todo in todos/',
    );
  });

  it('fails when the depends_on chain loops back on itself', async () => {
    const root = makeRepo({
      ...LINE_FILES,
      'todos/a.md': todoFile('a', ['line: standard', 'depends_on: b']),
      'todos/b.md': todoFile('b', ['line: standard', 'depends_on: a']),
    });

    const { exitCode, output } = await runLint(root);

    expect(exitCode).toBe(1);
    expect(output).toContain('forms a cycle');
  });

  it('fails when the heading slug does not match the file name', async () => {
    const root = makeRepo({
      ...LINE_FILES,
      'todos/a.md': todoFile('other', ['line: standard']),
    });

    const { exitCode, output } = await runLint(root);

    expect(exitCode).toBe(1);
    expect(output).toContain(
      'todos/a.md: heading slug other does not match file a',
    );
  });
});
