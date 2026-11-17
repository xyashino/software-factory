import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removeScratch, runCli, scratchDir } from './helpers/run-cli';

afterAll(removeScratch);

interface Scenario {
  repo: string;
  data: string;
  todos: string;
}

/**
 * A repository scaffolded with `factory init`, a todos folder, and a data directory with the project
 * `demo` added. Every test gets its own, so no test sees another's orders.
 */
const scenario = async (): Promise<Scenario> => {
  // The directory is named `demo`: the project id is the repository's directory name by default.
  const repo = join(scratchDir('factory-tasks-'), 'demo');
  mkdirSync(repo, { recursive: true });
  const data = scratchDir('factory-tasks-data-');
  const todos = join(repo, 'todos');
  mkdirSync(todos);
  const init = await runCli(data, ['init', '--dir', repo]);
  expect(init.code).toBe(0);
  const added = await runCli(data, [
    'project',
    'add',
    'demo',
    '--repo',
    'https://example.test/demo.git',
  ]);
  expect(added.code).toBe(0);
  return { repo, data, todos };
};

/** A todo file: frontmatter from `front` (lines of YAML) and an H1 `# <id>: <title>`. */
const writeTodo = (
  s: Scenario,
  id: string,
  front: string,
  status = 'todo',
): string => {
  const path = join(s.todos, `${id}.md`);
  const hasLine = /^line:/m.test(front);
  writeFileSync(
    path,
    `---\nstatus: ${status}\nfactory: v2\n${hasLine ? '' : 'line: feature\n'}${front}---\n\n# ${id}: Title of ${id}\n\nBody of ${id}.\n`,
  );
  return path;
};

const boardOf = async (s: Scenario): Promise<string[]> => {
  const run = await runCli(s.data, ['status', '--all', '--json']);
  expect(run.code).toBe(0);
  const body = JSON.parse(run.stdout) as { orders?: { orderId: string }[] };
  return (body.orders ?? []).map((order) => order.orderId).sort();
};

describe('factory order create', () => {
  it('creates a Work order from --body and prints its id', async () => {
    const s = await scenario();
    const run = await runCli(s.data, [
      'order',
      'create',
      '--project',
      'demo',
      '--todo-id',
      'alpha',
      '--title',
      'Alpha',
      '--type',
      'feat',
      '--line',
      'feature',
      '--repo-dir',
      s.repo,
      '--body',
      'Do alpha.',
    ]);

    expect(run.code).toBe(0);
    expect(run.stdout.trim()).toBe('created demo:alpha');
  });

  it('reads the spec from stdin with - and prints the answer as JSON', async () => {
    const s = await scenario();
    const run = await runCli(
      s.data,
      [
        'order',
        'create',
        '--project',
        'demo',
        '--todo-id',
        'beta',
        '--title',
        'Beta',
        '--type',
        'fix',
        '--line',
        'feature',
        '--repo-dir',
        s.repo,
        '--file',
        '-',
        '--json',
      ],
      { stdin: 'The spec, from stdin.\n' },
    );

    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ dryRun: false });
    expect(await boardOf(s)).toEqual(['demo:beta']);
  });

  it('refuses a Line the repo does not define, and names the Lines it has', async () => {
    const s = await scenario();
    const run = await runCli(s.data, [
      'order',
      'create',
      '--project',
      'demo',
      '--todo-id',
      'gamma',
      '--title',
      'Gamma',
      '--type',
      'feat',
      '--line',
      'nope',
      '--repo-dir',
      s.repo,
      '--body',
      'x',
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('unknown line "nope"');
    expect(run.stderr).toContain('have: fast, feature, standard');
    expect(await boardOf(s)).toEqual([]);
  });

  it('refuses a spec given both ways', async () => {
    const s = await scenario();
    const run = await runCli(s.data, [
      'order',
      'create',
      '--project',
      'demo',
      '--todo-id',
      'delta',
      '--title',
      'Delta',
      '--type',
      'feat',
      '--line',
      'feature',
      '--repo-dir',
      s.repo,
      '--body',
      'x',
      '--file',
      join(s.repo, 'missing.md'),
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('not both');
  });

  it('refuses a change type outside the list', async () => {
    const s = await scenario();
    const run = await runCli(s.data, [
      'order',
      'create',
      '--project',
      'demo',
      '--todo-id',
      'eps',
      '--title',
      'Eps',
      '--type',
      'bogus',
      '--line',
      'feature',
      '--repo-dir',
      s.repo,
      '--body',
      'x',
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('--type must be');
  });
});

describe('factory order pr-state', () => {
  it('refuses a Work order that has no PR yet', async () => {
    const s = await scenario();
    await runCli(s.data, [
      'order',
      'create',
      '--project',
      'demo',
      '--todo-id',
      'zeta',
      '--title',
      'Zeta',
      '--type',
      'feat',
      '--line',
      'feature',
      '--repo-dir',
      s.repo,
      '--body',
      'x',
    ]);
    const run = await runCli(s.data, [
      'order',
      'pr-state',
      'demo:zeta',
      'open',
      '--pr-url',
      'https://github.test/pr/1',
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('no PR');
  });

  it('refuses a state outside open, merged and closed', async () => {
    const s = await scenario();
    const run = await runCli(s.data, [
      'order',
      'pr-state',
      'demo:zeta',
      'waiting',
      '--pr-url',
      'https://github.test/pr/1',
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('must be open, merged, closed');
  });

  it('needs --pr-url', async () => {
    const s = await scenario();
    const run = await runCli(s.data, [
      'order',
      'pr-state',
      'demo:zeta',
      'open',
    ]);

    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain('pr-url');
  });
});

describe('factory plan create', () => {
  const plan = (s: Scenario, slug: string, members: string[]) =>
    runCli(s.data, [
      'plan',
      'create',
      '--project',
      'demo',
      '--slug',
      slug,
      '--repo-dir',
      s.repo,
      '--members',
      ...members,
    ]);

  it('creates a chain in the order the members are given', async () => {
    const s = await scenario();
    const one = writeTodo(s, 'one', '');
    const two = writeTodo(s, 'two', 'depends_on: [one]\n');
    const run = await plan(s, 'chain', [one, two]);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('demo:one -> demo:two');
    const status = await runCli(s.data, ['plan', 'status', 'chain']);
    expect(status.stdout).toContain('one [queued] -> two');
  });

  it('refuses a member that depends on a later one, and writes nothing', async () => {
    const s = await scenario();
    const one = writeTodo(s, 'one', 'depends_on: [two]\n');
    const two = writeTodo(s, 'two', '');
    const run = await plan(s, 'backwards', [one, two]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('may depend only on the member before it');
    expect(await boardOf(s)).toEqual([]);
  });

  it('refuses a plan whose member order already exists, and writes nothing', async () => {
    const s = await scenario();
    const one = writeTodo(s, 'one', '');
    expect((await plan(s, 'first', [one])).code).toBe(0);
    const again = await plan(s, 'second', [one]);

    expect(again.code).toBe(1);
    expect(again.stderr).toContain('already exists');
    const plans = await runCli(s.data, ['plan', 'ls', '--json']);
    expect(
      JSON.parse(plans.stdout).plans.map((p: { slug: string }) => p.slug),
    ).toEqual(['first']);
  });

  it('refuses a member whose todo is done', async () => {
    const s = await scenario();
    const done = writeTodo(s, 'done-one', '', 'done');
    const run = await plan(s, 'old', [done]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('plan takes todo members only');
  });
});

describe('factory todos import', () => {
  const importTodos = (s: Scenario, extra: string[] = []) =>
    runCli(s.data, ['todos', 'import', ...extra], { cwd: s.repo });

  it('dry-runs with no flag inside the repo, and makes no change', async () => {
    const s = await scenario();
    writeTodo(s, 'alpha', '');
    const run = await importTodos(s);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('dry run');
    expect(run.stdout).toContain('would-create');
    expect(await boardOf(s)).toEqual([]);
  });

  it('creates the orders with --apply, and a second run creates nothing', async () => {
    const s = await scenario();
    writeTodo(s, 'a-one', 'plan: pl\n');
    writeTodo(s, 'a-two', 'plan: pl\ndepends_on: [a-one]\n');
    writeTodo(s, 'b-main', 'depends_on: [b-dep]\n');
    writeTodo(s, 'b-dep', '');

    expect((await importTodos(s, ['--apply'])).code).toBe(0);
    expect(await boardOf(s)).toEqual([
      'demo:a-one',
      'demo:a-two',
      'demo:b-dep',
      'demo:b-main',
    ]);

    const again = await importTodos(s, ['--apply']);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('0 created');
    expect(await boardOf(s)).toHaveLength(4);
  });

  it('refuses a project the server does not have', async () => {
    const s = await scenario();
    writeTodo(s, 'alpha', '');
    const run = await importTodos(s, ['--project', 'nobody']);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('project nobody is not registered');
  });

  it('with --apply --remove, deletes only what the server confirmed', async () => {
    const s = await scenario();
    writeTodo(s, 'keep-done', '', 'done');
    writeTodo(s, 'go', '');

    expect((await importTodos(s, ['--apply', '--remove'])).code).toBe(0);
    expect(existsSync(join(s.todos, 'go.md'))).toBe(false);
    expect(existsSync(join(s.todos, 'keep-done.md'))).toBe(true);
  });
});

describe('factory todos export', () => {
  const exportTodos = (s: Scenario) =>
    runCli(s.data, ['todos', 'export'], { cwd: s.repo });
  const importTodos = (s: Scenario, extra: string[] = []) =>
    runCli(s.data, ['todos', 'import', ...extra], { cwd: s.repo });

  it('writes a file for each order with none, and lists the ones it skips', async () => {
    const s = await scenario();
    writeTodo(s, 'alpha', '');
    writeTodo(s, 'beta', 'priority: high\n');
    expect(
      (await runCli(s.data, ['todos', 'import', '--apply'], { cwd: s.repo }))
        .code,
    ).toBe(0);
    unlinkSync(join(s.todos, 'alpha.md'));
    const betaBefore = readFileSync(join(s.todos, 'beta.md'), 'utf8');

    const run = await exportTodos(s);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('written  todos/alpha.md');
    expect(run.stdout).toContain('skipped  todos/beta.md  file exists');
    expect(existsSync(join(s.todos, 'alpha.md'))).toBe(true);
    expect(readFileSync(join(s.todos, 'beta.md'), 'utf8')).toBe(betaBefore);
  });

  it('a clean server imports the exported todos back as the same orders', async () => {
    const s = await scenario();
    writeTodo(s, 'a-one', 'plan: pl\n');
    writeTodo(s, 'a-two', 'plan: pl\ndepends_on: [a-one]\n');
    writeTodo(s, 'b-main', 'depends_on: [b-dep]\npriority: high\n');
    writeTodo(s, 'b-dep', '');
    expect((await importTodos(s, ['--apply'])).code).toBe(0);
    const original = await boardOf(s);
    const names = ['a-one', 'a-two', 'b-main', 'b-dep'].map((id) => `${id}.md`);
    for (const name of names) unlinkSync(join(s.todos, name));
    expect((await exportTodos(s)).code).toBe(0);

    const clean = await scenario();
    for (const name of names) {
      writeFileSync(
        join(clean.todos, name),
        readFileSync(join(s.todos, name), 'utf8'),
      );
    }
    expect((await importTodos(clean, ['--apply'])).code).toBe(0);
    expect(await boardOf(clean)).toEqual(original);
  });
});

describe('factory todos migrate (deprecated alias)', () => {
  const migrate = (s: Scenario, extra: string[] = []) =>
    runCli(s.data, [
      'todos',
      'migrate',
      '--project',
      'demo',
      '--repo-dir',
      s.repo,
      ...extra,
    ]);

  it('still imports, and prints the deprecation line', async () => {
    const s = await scenario();
    writeTodo(s, 'alpha', '');
    const run = await migrate(s);

    expect(run.code).toBe(0);
    expect(run.stderr).toContain('deprecated: use factory todos import');
    expect(await boardOf(s)).toEqual(['demo:alpha']);
  });

  it('refuses a project the server does not have, before any line is printed', async () => {
    const s = await scenario();
    writeTodo(s, 'alpha', '');
    const run = await runCli(s.data, [
      'todos',
      'migrate',
      '--project',
      'nobody',
      '--repo-dir',
      s.repo,
      '--dry-run',
    ]);

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('project nobody is not registered');
    expect(run.stdout).toBe('');
  });

  it('dry-run lists what it would create and makes no change', async () => {
    const s = await scenario();
    writeTodo(s, 'alpha', '');
    const run = await migrate(s, ['--dry-run']);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain('would-create');
    expect(run.stdout).toContain('type=feat (default)');
    expect(await boardOf(s)).toEqual([]);
    expect(existsSync(join(s.todos, 'alpha.md'))).toBe(true);
  });

  it('creates a chain, a dependency and a done todo left alone, then is idempotent', async () => {
    const s = await scenario();
    writeTodo(s, 'a-one', 'plan: pl\n');
    writeTodo(s, 'a-two', 'plan: pl\ndepends_on: [a-one]\n');
    writeTodo(s, 'b-main', 'depends_on: [b-dep]\n');
    writeTodo(s, 'b-dep', '');
    writeTodo(s, 'c-old', '', 'done');

    const first = await migrate(s);
    expect(first.code).toBe(0);
    expect(await boardOf(s)).toEqual([
      'demo:a-one',
      'demo:a-two',
      'demo:b-dep',
      'demo:b-main',
    ]);

    const second = await migrate(s);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('0 created');
    expect(second.stdout).not.toContain('reused_id');
    expect(await boardOf(s)).toHaveLength(4);
  });

  it('with --remove, deletes only what the server confirmed', async () => {
    const s = await scenario();
    writeTodo(s, 'keep-done', '', 'done');
    writeTodo(s, 'go', '');

    const run = await migrate(s, ['--remove']);

    expect(run.code).toBe(0);
    expect(existsSync(join(s.todos, 'go.md'))).toBe(false);
    expect(existsSync(join(s.todos, 'keep-done.md'))).toBe(true);
  });

  it('after --remove, a second run finds nothing to do and exits 0', async () => {
    const s = await scenario();
    writeTodo(s, 'once', '');
    expect((await migrate(s, ['--remove'])).code).toBe(0);

    const again = await migrate(s, ['--remove']);
    expect(again.code).toBe(0);
    expect(await boardOf(s)).toEqual(['demo:once']);
  });

  it('reports a file with a bad Line as an error and creates nothing that depends on it', async () => {
    const s = await scenario();
    writeTodo(s, 'bad', 'line: nope\n');
    writeTodo(s, 'after', 'depends_on: [bad]\n');
    writeTodo(s, 'fine', '');

    const run = await migrate(s);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain('unknown_line');
    expect(run.stdout).toContain('depends on demo:bad');
    expect(await boardOf(s)).toEqual(['demo:fine']);
  });

  it('leaves a todo without factory: v2 out unless --all', async () => {
    const s = await scenario();
    writeFileSync(
      join(s.todos, 'plain.md'),
      '---\nstatus: todo\nline: feature\n---\n\n# plain: Plain\n\nx\n',
    );

    expect((await migrate(s)).code).toBe(0);
    expect(await boardOf(s)).toEqual([]);

    expect((await migrate(s, ['--all'])).code).toBe(0);
    expect(await boardOf(s)).toEqual(['demo:plain']);
  });

  it('reports the same result as JSON with --json', async () => {
    const s = await scenario();
    writeTodo(s, 'js', '');
    const run = await migrate(s, ['--json']);

    expect(run.code).toBe(0);
    const body = JSON.parse(run.stdout) as {
      dryRun: boolean;
      counts: { created: number };
      items: { file: string; outcome: string }[];
    };
    expect(body.dryRun).toBe(false);
    expect(body.counts.created).toBe(1);
    expect(body.items).toEqual([
      expect.objectContaining({ outcome: 'created', file: 'todos/js.md' }),
    ]);
  });
});
