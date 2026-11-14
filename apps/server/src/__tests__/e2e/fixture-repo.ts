import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '../../adapters/run';

/** A todo file as a repository holds it: frontmatter, a title, a body. */
export const todoFile = (options: {
  title: string;
  body?: string;
  status?: 'todo' | 'done' | 'cancelled';
  v2?: boolean;
  /** The Order Plan slug this todo is a member of (`plan:` in the frontmatter). */
  plan?: string;
  /** The todo ids this todo depends on (`depends_on:`). */
  dependsOn?: string[];
}): string => {
  const plan = options.plan === undefined ? '' : `plan: ${options.plan}\n`;
  const dependsOn =
    options.dependsOn === undefined || options.dependsOn.length === 0
      ? ''
      : `depends_on: [${options.dependsOn.join(', ')}]\n`;
  return `---\nstatus: ${options.status ?? 'todo'}\n${options.v2 ? 'factory: v2\n' : ''}${plan}${dependsOn}priority: high\n---\n\n# ${options.title}\n\n${options.body ?? 'Users can sign in.'}\n`;
};

/**
 * A real git repository on `main` with one commit: the given todo files under `todos/`. The intake
 * mirrors it with the real git adapter, so the e2e tests exercise `git` and not a stand-in.
 */
export const createFixtureRepo = async (
  dir: string,
  todos: Record<string, string>,
): Promise<string> => {
  await mkdir(join(dir, 'todos'), { recursive: true });
  for (const [name, text] of Object.entries(todos)) {
    await Bun.write(join(dir, 'todos', `${name}.md`), text);
  }
  const git = (args: string[]) => runProcess(['git', '-C', dir, ...args]);
  await git(['init', '--quiet', '-b', 'main']);
  await git(['add', '.']);
  await git([
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--quiet',
    '-m',
    'fixture todos',
  ]);
  return dir;
};

/** Writes one more todo file and commits it, as a push to the base branch would. */
export const pushTodo = async (
  dir: string,
  name: string,
  text: string | undefined,
): Promise<void> => {
  const path = join(dir, 'todos', `${name}.md`);
  if (text === undefined) {
    await runProcess(['git', '-C', dir, 'rm', '--quiet', `todos/${name}.md`]);
  } else {
    await Bun.write(path, text);
    await runProcess(['git', '-C', dir, 'add', `todos/${name}.md`]);
  }
  await runProcess([
    'git',
    '-C',
    dir,
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--quiet',
    '-m',
    `todo ${name}`,
  ]);
};
